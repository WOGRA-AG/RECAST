import { Injectable } from '@angular/core';
import {
  PostgrestSingleResponse,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  SupabaseClient,
} from '@supabase/supabase-js';
import { SupabaseService, Tables } from './supabase.service';
import {
  BehaviorSubject,
  catchError,
  concatMap,
  filter,
  from,
  map,
  merge,
  Observable,
  of,
  Subject,
} from 'rxjs';
import { ElementProperty } from '../../../build/openapi/recast';
import { camelCaseKeys, snakeCaseKeys } from '../shared/util/common-utils';

@Injectable({
  providedIn: 'root',
})
export class ElementPropertyService {
  private readonly _elementProperties$: BehaviorSubject<ElementProperty[]> =
    new BehaviorSubject<ElementProperty[]>([]);
  private readonly _supabaseClient: SupabaseClient = this.supabase.supabase;

  constructor(private readonly supabase: SupabaseService) {
    const sessionChanges$ = supabase.currentSession$.pipe(
      concatMap(() => this.loadProperties$()),
      catchError(() => of([]))
    );
    merge(sessionChanges$, this.propertyChanges$()).subscribe(properties => {
      this._elementProperties$.next(properties);
    });
  }

  get elementProperties$(): Observable<ElementProperty[]> {
    return this._elementProperties$;
  }

  get elementProperties(): ElementProperty[] {
    return this._elementProperties$.getValue();
  }

  public saveElementProp$(prop: ElementProperty): Observable<ElementProperty> {
    return this.upsertElementProp$(prop);
  }

  public deleteElementProperty$(
    id: number
  ): Observable<PostgrestSingleResponse<any>> {
    const del = this._supabaseClient
      .from(Tables.elementProperties)
      .delete()
      .eq('id', id);
    return from(del);
  }

  public elementPropertiesByElementId$(
    id: number
  ): Observable<ElementProperty[]> {
    return this._elementProperties$.pipe(
      map(props => props.filter(p => p.elementId === id))
    );
  }

  public elementPropertyByStepPropertyId(
    stepPropId: number
  ): ElementProperty | undefined {
    return this.elementProperties.find(p => p.stepPropertyId === stepPropId);
  }

  public elementPropertyByStepPropertyId$(
    elementId: number,
    stepPropId: number
  ): Observable<ElementProperty | undefined> {
    return this.elementProperties$.pipe(
      map(props =>
        props.find(
          p => p.stepPropertyId === stepPropId && p.elementId === elementId
        )
      )
    );
  }

  private upsertElementProp$(
    elementProperty: ElementProperty
  ): Observable<ElementProperty> {
    const upsert = this._supabaseClient
      .from(Tables.elementProperties)
      .upsert(snakeCaseKeys(elementProperty), {
        onConflict: 'step_property_id, element_id',
      })
      .select();
    return from(upsert).pipe(
      filter(({ data, error }) => !!data || !!error),
      map(({ data, error }) => {
        if (error) {
          throw error;
        }
        return camelCaseKeys(data[0]);
      })
    );
  }

  private propertyChanges$(): Observable<ElementProperty[]> {
    const changes$: Subject<ElementProperty[]> = new Subject<
      ElementProperty[]
    >();
    this._supabaseClient
      .channel('element-property-change')
      .on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL,
          schema: 'public',
          table: Tables.elementProperties,
        },
        payload => {
          const state = this._elementProperties$.getValue();
          switch (payload.eventType) {
            case 'INSERT': {
              changes$.next(
                this.insertElementProperty(state, camelCaseKeys(payload.new))
              );
              break;
            }
            case 'UPDATE': {
              changes$.next(
                this.updateElementProperty(state, camelCaseKeys(payload.new))
              );
              break;
            }
            case 'DELETE': {
              const elemProp: ElementProperty = payload.old;
              if (elemProp.id) {
                changes$.next(this.deleteElementProperty(state, elemProp.id));
              }
              break;
            }
            default: {
              break;
            }
          }
        }
      )
      .subscribe();
    return changes$;
  }

  private loadProperties$(): Observable<ElementProperty[]> {
    const select = this._supabaseClient
      .from(Tables.elementProperties)
      .select(`*`, { head: false, count: 'planned' });
    return from(select).pipe(
      map(({ data, error }) => {
        if (error) {
          throw error;
        }
        return data?.map(camelCaseKeys);
      })
    );
  }

  private deleteElementProperty(
    state: ElementProperty[],
    id: number
  ): ElementProperty[] {
    return state.filter(elemProp => elemProp.id !== id);
  }

  private insertElementProperty(
    state: ElementProperty[],
    elementProperty: ElementProperty
  ): ElementProperty[] {
    return state.concat(elementProperty);
  }

  private updateElementProperty(
    state: ElementProperty[],
    elementProperty: ElementProperty
  ): ElementProperty[] {
    return state.map(value =>
      value.id === elementProperty.id ? elementProperty : value
    );
  }
}
