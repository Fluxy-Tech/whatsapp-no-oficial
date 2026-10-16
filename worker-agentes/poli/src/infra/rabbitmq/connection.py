"""
Consumo do RabbitMQ com pika (BlockingConnection).

O pika não é thread-safe: só a thread de IO (a que roda start_consuming) pode
mexer no canal. O processamento pesado (LLM, ingestão) roda em threads de um
ThreadPoolExecutor — assim os heartbeats continuam saindo durante uma chamada
longa — e o publish/ack de volta é agendado na thread de IO com
add_callback_threadsafe.
"""

import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import pika

from src import config

RECONNECT_DELAY_SECONDS = 5


class Reply:
    """O que um handler devolve: mensagens a publicar antes do ack."""

    def __init__(self, publishes: list[tuple[str, dict]] | None = None):
        self.publishes = publishes or []


# handler(payload, publish_now) -> Reply | None. publish_now permite publicar
# no meio do processamento (ex.: status "processing" da ingestão).
Handler = Callable[[dict, Callable[[str, dict], None]], Reply | None]


def declare_queues(channel) -> None:
    for queue in config.AI_QUEUES:
        dlq = f"{queue}.dlq"
        channel.queue_declare(queue=dlq, durable=True)
        channel.queue_declare(
            queue=queue,
            durable=True,
            arguments={"x-dead-letter-exchange": "", "x-dead-letter-routing-key": dlq},
        )
    # Fila do worker-whatsapp: durável e sem argumentos, como ele declara.
    channel.queue_declare(queue=config.QUEUE_WHATSAPP_OUTBOUND, durable=True)


def _publish(channel, queue: str, payload: dict) -> None:
    channel.basic_publish(
        exchange="",
        routing_key=queue,
        body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
    )


def _erro_de_api(error: Exception) -> bool:
    return type(error).__name__ in {"ClientError", "ServerError", "APIError", "AuthenticationError", "RateLimitError"}


def resumo_erro(error: Exception) -> str:
    # google.genai.errors.APIError tem code/status/message.
    code = getattr(error, "code", None)
    message = getattr(error, "message", None)
    if code and message:
        return f"{type(error).__name__} {code}: {message}"
    return str(error)


class Consumer:
    def __init__(self):
        self._handlers: list[tuple[str, Handler, int]] = []

    def register(self, queue: str, handler: Handler, concurrency: int) -> None:
        self._handlers.append((queue, handler, concurrency))

    def run_forever(self) -> None:
        executors = {queue: ThreadPoolExecutor(max_workers=c, thread_name_prefix=queue) for queue, _, c in self._handlers}
        while True:
            try:
                self._run(executors)
            except KeyboardInterrupt:
                return
            except Exception as error:
                print(f"[rabbitmq] conexão perdida ({error}); reconectando em {RECONNECT_DELAY_SECONDS}s")
                time.sleep(RECONNECT_DELAY_SECONDS)

    def _run(self, executors: dict[str, ThreadPoolExecutor]) -> None:
        params = pika.URLParameters(config.URL_RABBITMQ)
        params.heartbeat = 60
        connection = pika.BlockingConnection(params)
        print("[rabbitmq] conectado")

        setup = connection.channel()
        declare_queues(setup)
        setup.close()

        for queue, handler, concurrency in self._handlers:
            # Um canal por fila: o prefetch de uma não segura a outra.
            channel = connection.channel()
            channel.basic_qos(prefetch_count=concurrency)
            channel.basic_consume(
                queue=queue,
                on_message_callback=self._make_callback(connection, channel, queue, handler, executors[queue]),
            )
            print(f"[rabbitmq] consumindo {queue} (concorrência {concurrency})")

        try:
            # Loop de IO: entrega mensagens, envia heartbeats e executa os
            # callbacks agendados pelas threads (publish/ack).
            while connection.is_open:
                connection.process_data_events(time_limit=1)
        finally:
            if connection.is_open:
                connection.close()

    @staticmethod
    def _make_callback(connection, channel, queue: str, handler: Handler, executor: ThreadPoolExecutor):
        def threadsafe(fn) -> None:
            try:
                connection.add_callback_threadsafe(fn)
            except Exception as error:
                # Conexão caiu no meio: a mensagem não foi confirmada e será reentregue.
                print(f"[rabbitmq] não foi possível concluir mensagem de {queue}: {error}")

        def publish_now(target_queue: str, payload: dict) -> None:
            threadsafe(lambda: _publish(channel, target_queue, payload))

        def on_message(_channel, method, _properties, body):
            def work():
                try:
                    payload = json.loads(body)
                    reply = handler(payload, publish_now) or Reply()

                    def finish():
                        for target_queue, message in reply.publishes:
                            _publish(channel, target_queue, message)
                        channel.basic_ack(delivery_tag=method.delivery_tag)

                    threadsafe(finish)
                except Exception as error:
                    print(f"[{queue}] erro, mensagem enviada para {queue}.dlq: {resumo_erro(error)}")
                    # Erro de API do Google/OpenAI (chave inválida, sem crédito...) já
                    # está explicado na linha acima; traceback só para erros inesperados.
                    if not _erro_de_api(error):
                        traceback.print_exc()
                    threadsafe(lambda: channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False))

            executor.submit(work)

        return on_message
