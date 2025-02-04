import { Injectable } from '@angular/core';
import { SupabaseService, Tables } from '../../services/supabase.service';
import {
  AuthError,
  PostgrestError,
  SupabaseClient,
} from '@supabase/supabase-js';
import {
  BehaviorSubject,
  catchError,
  concatMap,
  distinctUntilChanged,
  filter,
  from,
  map,
  Observable,
  of,
  Subject,
} from 'rxjs';
import { Profile } from '../../../../build/openapi/recast';
import {
  elementComparator,
  snakeCaseKeys,
  camelCaseKeys,
} from '../../shared/util/common-utils';

@Injectable({
  providedIn: 'root',
})
export class UserFacadeService {
  private readonly _currentProfile$: BehaviorSubject<Profile | null> =
    new BehaviorSubject<Profile | null>(null);
  private readonly _supabaseClient: SupabaseClient = this.supabase.supabase;

  constructor(private supabase: SupabaseService) {
    supabase.session$
      .pipe(
        filter(session => !!session),
        concatMap(() => this.updateProfile()),
        catchError(() => of(null)),
        distinctUntilChanged(elementComparator)
      )
      .subscribe(profile => {
        this._currentProfile$.next(profile);
      });
    this.profileChanges$()
      .pipe(distinctUntilChanged(elementComparator))
      .subscribe(profile => this._currentProfile$.next(profile));
  }

  get currentProfile$(): Observable<Profile> {
    return this._currentProfile$.pipe(
      filter(profile => !!profile),
      map(profile => profile!)
    );
  }

  get currentProfile(): Profile | null {
    return this._currentProfile$.getValue();
  }

  get profile$(): Observable<Profile | null> {
    return this._currentProfile$;
  }

  public saveProfile(profile: Profile): Observable<PostgrestError> {
    const update = {
      ...profile,
      updatedAt: new Date(),
    };
    const upsert = this._supabaseClient
      .from(Tables.profiles)
      .upsert(snakeCaseKeys(update));
    return from(upsert).pipe(map(({ error }) => error!));
  }

  public signIn(): Observable<AuthError> {
    const signIn = this._supabaseClient.auth.signInWithOAuth({
      provider: 'keycloak',
      options: { redirectTo: window.location.origin },
    });
    return from(signIn).pipe(map(({ error }) => error!));
  }

  public signOut(): Observable<AuthError | undefined> {
    const signout = this._supabaseClient.auth.signOut();
    return from(signout).pipe(
      map(({ error }) => {
        if (error) {
          return error;
        }
        window.location.href = 'https://login.os4ml.wogra.com/logout';
        return;
      })
    );
  }

  private profileChanges$(): Observable<Profile> {
    const changes$: Subject<Profile> = new Subject<Profile>();
    this._supabaseClient
      .channel('profiles-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: Tables.profiles },
        payload => {
          changes$.next(camelCaseKeys(payload.new));
        }
      )
      .subscribe();
    return changes$;
  }

  private updateProfile(): Observable<Profile> {
    const select = this._supabaseClient
      .from(Tables.profiles)
      .select(`*`)
      .single();
    return from(select).pipe(
      map(({ data: profile, error }) => {
        if (error) {
          throw error;
        }
        return camelCaseKeys(profile) as Profile;
      })
    );
  }
}
