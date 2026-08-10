import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuthUser } from 'src/types/AuthUser';
import { UserService } from 'src/user/user.service';

@Injectable()
export class UserLastActiveOnInterceptor implements NestInterceptor {
  constructor(private userService: UserService) {}

  private readonly userRecentUpdateMap = new Map<string, number>();
  private readonly DEBOUNCE_MS = 60_000;

  private shouldUpdate(userUid: string): boolean {
    const userRecentUpdate = this.userRecentUpdateMap.get(userUid) ?? 0;
    const now = Date.now();
    if (now - userRecentUpdate < this.DEBOUNCE_MS) {
      return false;
    }
    this.userRecentUpdateMap.set(userUid, now);
    return true;
  }

  /**
   * Fire-and-forget update of the user's last-active timestamp.
   *
   * No-ops unless the request has an authenticated user (`user?.uid`) and the
   * debounce window has elapsed (`shouldUpdate`), so a given user triggers at
   * most one DB write per `DEBOUNCE_MS`. The underlying update is not awaited;
   * `userService.updateUserLastActiveOn` handles its own errors internally.
   *
   * @param user The authenticated user from the request, if any.
   */
  private updateUserLastActive(user: AuthUser) {
    if (user?.uid && this.shouldUpdate(user.uid)) {
      this.userService.updateUserLastActiveOn(user.uid);
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() === 'http') {
      return this.restHandler(context, next);
    } else if (context.getType<GqlContextType>() === 'graphql') {
      return this.graphqlHandler(context, next);
    }
  }

  restHandler(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user: AuthUser = request.user;

    return next.handle().pipe(
      tap(() => {
        this.updateUserLastActive(user);
      }),
      catchError((error) => {
        this.updateUserLastActive(user);
        return throwError(() => error);
      }),
    );
  }

  graphqlHandler(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const contextObject = GqlExecutionContext.create(context).getContext();
    const user: AuthUser = contextObject?.req?.user;

    return next.handle().pipe(
      tap(() => {
        this.updateUserLastActive(user);
      }),
      catchError((error) => {
        this.updateUserLastActive(user);
        return throwError(() => error);
      }),
    );
  }
}
