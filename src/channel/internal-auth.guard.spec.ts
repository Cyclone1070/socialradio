import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalAuthGuard } from './internal-auth.guard';

describe('InternalAuthGuard', () => {
  let guard: InternalAuthGuard;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(() => {
    configService = mockConfigService as unknown as ConfigService;
    guard = new InternalAuthGuard(configService);
    jest.clearAllMocks();
  });

  function createMockContext(
    headers: Record<string, string>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access when X-Internal-Token matches configured secret', () => {
    mockConfigService.get.mockReturnValue('test-internal-secret');
    const context = createMockContext({
      'x-internal-token': 'test-internal-secret',
    });

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when X-Internal-Token header is missing', () => {
    mockConfigService.get.mockReturnValue('test-internal-secret');
    const context = createMockContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when X-Internal-Token does not match secret', () => {
    mockConfigService.get.mockReturnValue('test-internal-secret');
    const context = createMockContext({
      'x-internal-token': 'wrong-secret',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when INTERNAL_SERVICE_SECRET is not configured', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const context = createMockContext({
      'x-internal-token': 'some-token',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
