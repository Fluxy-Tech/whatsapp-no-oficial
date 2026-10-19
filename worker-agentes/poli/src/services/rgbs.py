"""
RGBS (Receives, Generates, Breaks and Sends).

Com agent.rgbs.enabled, o prompt pede a resposta quebrada com [QB] (Generates),
partes_da_resposta divide o texto (Breaks) e enviar_partes manda cada parte
como uma mensagem do WhatsApp, esperando antes de cada uma um tempo que depende
do tamanho dela (Sends):

  até 40 caracteres  -> timeSmall
  até 100 caracteres -> timeMedium
  acima disso        -> timeLarge

O envio roda numa thread própria: dormir na thread do job seguraria uma das
vagas de AI_CONCURRENCY e travaria as conversas de outros contatos. A mensagem
da fila é confirmada (ACK) logo depois de agendar as partes; publish_now leva
cada publicação para a thread de IO do pika (o canal não é thread-safe).
"""

import threading
import time
import traceback

from src.services.adk.infos import QUEBRA_MENSAGEM

# Mesmos mínimos do backend (RGBS_TIMES) e do frontend: mantenha iguais. Valem
# mesmo se o payload vier com valor menor, vazio ou inválido.
RGBS_MIN_SECONDS = {"timeSmall": 1, "timeMedium": 4, "timeLarge": 8}
RGBS_DEFAULT_SECONDS = {"timeSmall": 5, "timeMedium": 10, "timeLarge": 15}
RGBS_MAX_SECONDS = 300


def rgbs_ativo(agent: dict) -> bool:
    return bool((agent.get("rgbs") or {}).get("enabled"))


def partes_da_resposta(texto: str, quebrar: bool) -> list[str]:
    """Com o RGBS, cada trecho entre [QB] vira uma mensagem (vazios
    descartados). Sem ele, um [QB] que o modelo escreva vira quebra de
    parágrafo: o marcador nunca chega cru no WhatsApp."""
    if not quebrar:
        partes = [parte.strip() for parte in texto.split(QUEBRA_MENSAGEM) if parte.strip()]
        return ["\n\n".join(partes)] if partes else []
    return [parte.strip() for parte in texto.split(QUEBRA_MENSAGEM) if parte.strip()]


def espera_da_parte(texto: str, rgbs: dict) -> int:
    """Segundos de espera antes de enviar a parte, pela faixa de tamanho."""
    tamanho = len(texto)
    campo = "timeSmall" if tamanho <= 40 else "timeMedium" if tamanho <= 100 else "timeLarge"
    try:
        segundos = int(rgbs.get(campo))
    except (TypeError, ValueError):
        segundos = RGBS_DEFAULT_SECONDS[campo]
    return min(max(segundos, RGBS_MIN_SECONDS[campo]), RGBS_MAX_SECONDS)


# Uma trava por contato: se o contato mandar mensagem enquanto as partes de uma
# resposta ainda estão saindo, as partes da próxima resposta só começam depois.
_travas: dict[str, threading.Lock] = {}
_travas_lock = threading.Lock()


def _trava(chave: str) -> threading.Lock:
    with _travas_lock:
        return _travas.setdefault(chave, threading.Lock())


def enviar_partes(chave: str, publishes: list[tuple[str, dict]], rgbs: dict, publish_now, log) -> None:
    """Agenda o envio das partes (destino, payload com "text") em ordem, cada
    uma depois da sua espera. Volta logo; o envio continua em segundo plano."""
    if not publishes:
        return
    trava = _trava(chave)
    # Pega a trava aqui (e não na thread) para manter a ordem entre respostas.
    trava.acquire()

    def enviar() -> None:
        try:
            for i, (destino, payload) in enumerate(publishes, start=1):
                espera = espera_da_parte(payload.get("text") or "", rgbs)
                time.sleep(espera)
                publish_now(destino, payload)
                log(f"RGBS: parte {i}/{len(publishes)} enviada após {espera}s")
        except Exception as error:
            log(f"RGBS: falha ao enviar as partes: {error}")
            traceback.print_exc()
        finally:
            trava.release()

    threading.Thread(target=enviar, name=f"rgbs-{chave}", daemon=True).start()
