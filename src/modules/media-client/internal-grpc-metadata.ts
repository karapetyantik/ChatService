import { Metadata } from '@grpc/grpc-js';

/** Shared secret sent to internal gRPC servers (e.g. MediaService's MediaInternal) that gate access via InternalGrpcAuthGuard. */
export function buildInternalGrpcMetadata(internalApiKey: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-internal-key', internalApiKey);
  return metadata;
}
