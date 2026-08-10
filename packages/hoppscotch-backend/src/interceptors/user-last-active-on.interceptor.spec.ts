import { mockDeep, mockReset } from 'jest-mock-extended';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { UserService } from 'src/user/user.service';
import { AuthUser } from 'src/types/AuthUser';
import { UserLastActiveOnInterceptor } from './user-last-active-on.interceptor';

const mockUserService = mockDeep<UserService>();

const user: AuthUser = {
  uid: '123344',
  email: 'dwight@dundermifflin.com',
  displayName: 'Dwight Schrute',
  photoURL: 'https://en.wikipedia.org/wiki/Dwight_Schrute',
} as AuthUser;

/** Builds an HTTP ExecutionContext carrying the given `request.user`. */
const httpContext = (reqUser: unknown): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
  }) as unknown as ExecutionContext;

/** CallHandler that emits a successful response. */
const okHandler = (): CallHandler => ({ handle: () => of('response') });

/** CallHandler that errors. */
const errHandler = (error: unknown): CallHandler => ({
  handle: () => throwError(() => error),
});

describe('UserLastActiveOnInterceptor', () => {
  let interceptor: UserLastActiveOnInterceptor;
  let nowSpy: jest.SpyInstance<number>;
  let now: number;

  beforeEach(() => {
    mockReset(mockUserService);
    // Fresh interceptor per test so the debounce map starts empty.
    interceptor = new UserLastActiveOnInterceptor(mockUserService);
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => nowSpy.mockRestore());

  it('updates last-active on a successful request', async () => {
    const res = await lastValueFrom(
      interceptor.restHandler(httpContext(user), okHandler()),
    );

    expect(res).toBe('response');
    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledTimes(1);
    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledWith(
      user.uid,
    );
  });

  it('debounces repeat requests within the debounce window', async () => {
    await lastValueFrom(
      interceptor.restHandler(httpContext(user), okHandler()),
    );
    now += 30_000; // still inside the 60s window
    await lastValueFrom(
      interceptor.restHandler(httpContext(user), okHandler()),
    );

    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledTimes(1);
  });

  it('updates again once the debounce window has elapsed', async () => {
    await lastValueFrom(
      interceptor.restHandler(httpContext(user), okHandler()),
    );
    now += 60_001; // past the 60s window
    await lastValueFrom(
      interceptor.restHandler(httpContext(user), okHandler()),
    );

    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledTimes(2);
  });

  it('skips the update when the request has no authenticated user', async () => {
    await lastValueFrom(
      interceptor.restHandler(httpContext(undefined), okHandler()),
    );

    expect(mockUserService.updateUserLastActiveOn).not.toHaveBeenCalled();
  });

  it('still updates and re-throws on the error path', async () => {
    const boom = new Error('boom');

    await expect(
      lastValueFrom(
        interceptor.restHandler(httpContext(user), errHandler(boom)),
      ),
    ).rejects.toBe(boom);

    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledTimes(1);
    expect(mockUserService.updateUserLastActiveOn).toHaveBeenCalledWith(
      user.uid,
    );
  });
});
