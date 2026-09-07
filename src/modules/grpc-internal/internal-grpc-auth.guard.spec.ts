import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalGrpcAuthGuard } from './internal-grpc-auth.guard';

function contextWithMetadataValue(value: string[] | undefined) {
  return {
    switchToRpc: () => ({
      getContext: () => ({
        get: (field: string) =>
          field === 'x-internal-key' ? (value ?? []) : [],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalGrpcAuthGuard', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue('correct-secret'),
  } as unknown as ConfigService;
  const guard = new InternalGrpcAuthGuard(config);

  it('allows a call presenting the correct shared secret', () => {
    expect(
      guard.canActivate(contextWithMetadataValue(['correct-secret'])),
    ).toBe(true);
  });

  it('rejects a call with the wrong secret', () => {
    expect(() =>
      guard.canActivate(contextWithMetadataValue(['wrong-secret'])),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a call with no secret at all', () => {
    expect(() =>
      guard.canActivate(contextWithMetadataValue(undefined)),
    ).toThrow(UnauthorizedException);
  });
});
