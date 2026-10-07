import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

// SeaweedFS expõe a API S3 em path-style (endpoint/bucket/key), não em
// virtual-host (bucket.endpoint/key).
export const s3 = new S3Client({
  endpoint: env.SEAWEEDFS_S3_ENDPOINT,
  region: env.SEAWEEDFS_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.SEAWEEDFS_S3_ACCESS_KEY,
    secretAccessKey: env.SEAWEEDFS_S3_SECRET_KEY,
  },
});
