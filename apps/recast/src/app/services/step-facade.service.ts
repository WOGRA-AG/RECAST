import {Injectable} from '@angular/core';
import {SupabaseService} from './supabase.service';
import {
  AuthSession,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT, RealtimeChannel,
  SupabaseClient
} from '@supabase/supabase-js';
import {Step, StepProperty} from '../../../build/openapi/recast';
import {
  BehaviorSubject,
  from,
  groupBy,
  mergeMap,
  Observable,
  reduce,
} from 'rxjs';
import {StepPropertyService} from './step-property.service';

const snakeCase = require('snakecase-keys');
const camelCase = require('camelcase-keys');

@Injectable({
  providedIn: 'root'
})
export class StepFacadeService {

  steps$: BehaviorSubject<Step[]> = new BehaviorSubject<Step[]>([]);
  private supabaseClient: SupabaseClient = this.supabase.client;
  private session: AuthSession | null = this.supabase.session;
  private stepProps: StepProperty[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stepPropertyService: StepPropertyService,
  ) {
    supabase.session$.subscribe(session => {
      this.session = session;
      this.updateSteps();
    });
    stepPropertyService.stepProperties$.subscribe(val => {
      this.stepProps = val;
      this.groupPropertiesByStepId(val).subscribe(({ stepId, values }) => {
        if (!stepId) {return;}
        this.steps$.next(
          this.addPropertiesToSteps(this.steps$.getValue(), stepId, values)
        );
      });
    });
    this.dbRealtimeChannel().subscribe();
  }

  private groupPropertiesByStepId(val: StepProperty[]):
    Observable<{ stepId: number | undefined; values: StepProperty[] }> {
    return from(val).pipe(
      groupBy(stepProp => stepProp.stepId),
      mergeMap(group$ =>
        group$.pipe(
          reduce((acc, cur) => {
            acc.values.push(cur);
            return acc;
          }, {stepId: group$.key, values: [] as StepProperty[]})
        )
      )
    );
  }

  private dbRealtimeChannel(): RealtimeChannel {
    return this.supabaseClient
      .channel('step-change')
      .on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL,
          schema: 'public',
          table: 'Steps'
        },
        payload => {
          const state = this.steps$.getValue();
          switch (payload.eventType) {
            case 'INSERT':
              this.steps$.next(
                this.insertStep(state, camelCase(payload.new))
              );
              break;
            case 'UPDATE':
              this.updateStepWithProperties(state, camelCase(payload.new));
              break;
            case 'DELETE':
              const step: Step = payload.old;
              if (step.id) {
                this.steps$.next(
                  this.deleteStep(state, step.id)
                );
              }
              break;
            default:
              break;
          }
        }
      );
  }

  private updateSteps(): void {
    this.supabaseClient
      .from('Steps')
      .select(`
        *,
        step_properties: StepProperties (*)
      `)
      .then(({data, error, status}) => {
        if (error && status !== 406) {throw error;}
        if (!data) {return;}
        this.steps$.next(
          this.stepsToCamelCase(data)
        );
      });
  }

  private stepsToCamelCase(state: Step[]): Step[] {
    return state.map(step => {
      step = camelCase(step);
      step.stepProperties = step.stepProperties?.map(camelCase);
      return step;
    });
  }

  private deleteStep(state: Step[], id: number): Step[] {
    return state.filter(step => step.id !== id);
  }

  private insertStep(state: Step[], step: Step): Step[] {
    return state.concat(step);
  }

  private updateStepWithProperties(state: Step[], step: Step): void {
    this.groupPropertiesByStepId(this.stepProps).subscribe(({ stepId, values }) => {
      if (!stepId) {return;}
      step = this.addPropertiesToStep(step, stepId, values);
      this.steps$.next(
        state.map(value => value.id === step.id ? step : value)
      );
    });
  }

  private addPropertiesToSteps(state: Step[], stepId: number, values: StepProperty[]): Step[] {
    return state.map(step => this.addPropertiesToStep(step, stepId, values));
  }

  private addPropertiesToStep(step: Step, stepId: number, values: StepProperty[]): Step {
    if (step.id === stepId) {
      step.stepProperties = values;
    }
    return step;
  }
}
