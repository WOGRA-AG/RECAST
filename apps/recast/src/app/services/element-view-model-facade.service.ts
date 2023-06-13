import { Injectable } from '@angular/core';
import {
  ElementViewModel,
  ElementViewProperty,
  ValueType,
} from '../model/element-view-model';
import {
  BehaviorSubject,
  map,
  Observable,
  of,
  filter,
  switchMap,
  distinctUntilChanged,
  combineLatestWith,
  mergeMap,
  from,
  toArray,
  take,
} from 'rxjs';
import { ElementFacadeService } from './element-facade.service';
import { ProcessFacadeService } from './process-facade.service';
import {
  Element,
  Process,
  Step,
  StepProperty,
  ElementProperty,
} from '../../../build/openapi/recast';
import { StepFacadeService } from './step-facade.service';
import { elementComparator } from '../shared/util/common-utils';
import {
  addObjectToState,
  removeObjectFromState,
} from '../shared/util/state-management';
import TypeEnum = StepProperty.TypeEnum;
import StorageBackendEnum = ElementProperty.StorageBackendEnum;
import { StorageService } from '../storage/services/storage.service';

@Injectable({
  providedIn: 'root',
})
export class ElementViewModelFacadeService {
  private _elementViewModels$ = new BehaviorSubject<ElementViewModel[]>([]);
  constructor(
    private readonly processService: ProcessFacadeService,
    private readonly elementService: ElementFacadeService,
    private readonly stepService: StepFacadeService,
    private readonly storageService: StorageService
  ) {
    this._elements$()
      .pipe(
        mergeMap(elements => from(elements)),
        mergeMap(elements => this._initElementViewModels$(elements)),
        map(elementViewModel =>
          this._addOrUpdateElementViewModel(elementViewModel)
        )
      )
      .subscribe();
  }

  public elementViewModelByElementId$(
    elementId: number
  ): Observable<ElementViewModel | undefined> {
    return this._elementViewModels$.pipe(
      filter(elementViewModels => !!elementViewModels.length),
      map(elementViewModels =>
        elementViewModels.find(
          (elementViewModel: ElementViewModel) =>
            elementViewModel.element.id === elementId
        )
      ),
      mergeMap(model => {
        if (!model) {
          return of(undefined);
        }
        return this.storageService.loadValues$(model);
      }),
      distinctUntilChanged(elementComparator)
    );
  }

  public saveElementFromElementViewModel$(
    elementViewModel: ElementViewModel
  ): Observable<Element> {
    const element: Element = {
      id: elementViewModel.element.id,
      processId: elementViewModel.process.id,
      currentStepId: elementViewModel.currentStep
        ? elementViewModel.currentStep.id
        : null,
      elementProperties: elementViewModel.properties
        .filter(prop => !!prop.value)
        .map(
          (elementViewProperty: ElementViewProperty): ElementProperty => ({
            value: '' + elementViewProperty.value,
            stepPropertyId: elementViewProperty.stepPropId,
            storageBackend: elementViewProperty.storageBackend,
            elementId: elementViewModel.element.id,
          })
        ),
    };
    return this.elementService.saveElement$(element);
  }

  public storageBackendsByProcessId$(
    processId: number
  ): Observable<StorageBackendEnum[]> {
    return this.elementService.elementsByProcessId$(processId).pipe(
      take(1),
      mergeMap(elements => from(elements)),
      mergeMap(element =>
        this.elementViewModelByElementId$(element.id!).pipe(take(1))
      ),
      map(elementViewModel => elementViewModel?.storageBackends ?? []),
      toArray(),
      map(backends => {
        if (!backends) {
          return [];
        }
        return [...new Set(backends.flat())];
      })
    );
  }

  public updateValuesFromElementViewModel$(
    elementViewModel: ElementViewModel
  ): Observable<Element> {
    return this.storageService
      .updateValues$(elementViewModel)
      .pipe(mergeMap(model => this.saveElementFromElementViewModel$(model)));
  }

  public deleteProcess$(process: Process): Observable<void> {
    if (!process.id!) {
      return of(undefined);
    }
    return this.storageBackendsByProcessId$(process.id).pipe(
      switchMap(backends =>
        this.storageService.deleteProcess$(process, backends)
      )
    );
  }

  public deleteElement$(element: Element): Observable<void> {
    if (!element.id!) {
      return of(undefined);
    }
    return this.elementViewModelByElementId$(element.id).pipe(
      switchMap(elementViewModel => {
        if (!elementViewModel) {
          return of(undefined);
        }
        return this.storageService.deleteElement$(element, elementViewModel);
      })
    );
  }

  private _initElementViewModels$(
    element: Element
  ): Observable<ElementViewModel> {
    return this._elementViewModelFromElement$(element).pipe(
      distinctUntilChanged(elementComparator)
    );
  }

  private _elementViewModelFromElement$(
    element: Element
  ): Observable<ElementViewModel> {
    return this._processById$(element.processId!).pipe(
      combineLatestWith(
        this._stepById$(element.currentStepId!),
        this._stepsByProcessId$(element.processId!),
        this._stepPropertiesByProcessId$(element.processId!)
      ),
      filter(([process, _1, _2, _3]) => !!process),
      switchMap(([process, step, steps, stepProperties]) =>
        this._elementViewModelFromElementAndProcessAndStepAndStepPropertiesAndElementProperties$(
          element,
          process,
          step,
          steps,
          stepProperties
        )
      )
    );
  }

  private _elementViewModelFromElementAndProcessAndStepAndStepPropertiesAndElementProperties$(
    element: Element,
    process: Process | undefined,
    step: Step | undefined,
    steps: Step[],
    stepProperties: StepProperty[]
  ): Observable<ElementViewModel> {
    if (!process) {
      throw new Error('Process is undefined');
    }
    const elementViewProperties: ElementViewProperty[] =
      this._elementViewModelsFromElementPropertiesAndStepProperties(
        element.elementProperties ?? [],
        stepProperties
      );
    const storageBackendsList: StorageBackendEnum[] = elementViewProperties
      .filter((evp: ElementViewProperty) => !!evp.storageBackend)
      .map((evp: ElementViewProperty) => evp.storageBackend!);
    const uniqueStorageBackends = [...new Set(storageBackendsList)];
    return of({
      element,
      process,
      storageBackends: uniqueStorageBackends,
      currentStep: step,
      sortedSteps: steps,
      properties: elementViewProperties,
    });
  }

  private _elements$(): Observable<Element[]> {
    return this.elementService.elements$;
  }

  private _processById$(id: number): Observable<Process | undefined> {
    return this.processService.processById$(id);
  }

  private _stepById$(id: number): Observable<Step | undefined> {
    return this.stepService.stepById$(id);
  }

  private _stepsByProcessId$(id: number): Observable<Step[]> {
    return this.stepService.stepsByProcessId$(id);
  }

  private _stepPropertiesByProcessId$(id: number): Observable<StepProperty[]> {
    return this.stepService.stepsByProcessId$(id).pipe(
      map(steps => {
        const stepProperties: StepProperty[] = [];
        steps.forEach(step => {
          stepProperties.push(...(step.stepProperties ?? []));
        });
        return stepProperties;
      }),
      distinctUntilChanged(elementComparator)
    );
  }

  private _elementViewModelsFromElementPropertiesAndStepProperties(
    elementProperties: ElementProperty[],
    stepProperties: StepProperty[]
  ): ElementViewProperty[] {
    const elementViewProperties: ElementViewProperty[] = [];
    stepProperties.forEach(stepProperty => {
      const elementProperty = elementProperties.find(
        prop => prop.stepPropertyId === stepProperty.id
      );
      elementViewProperties.push({
        type: stepProperty.type!,
        label: stepProperty.name!,
        hint: stepProperty.description!,
        stepPropId: stepProperty.id!,
        stepId: stepProperty.stepId!,
        storageBackend: elementProperty?.storageBackend,
        defaultValue: this._formatDefaultValue(
          stepProperty.defaultValue,
          stepProperty.type!
        ),
        value: elementProperty?.value,
      });
    });
    return elementViewProperties;
  }

  private _formatDefaultValue(
    defaultValue: string | null | undefined,
    type: TypeEnum
  ): ValueType {
    let value: ValueType = defaultValue ?? '';
    if (type === TypeEnum.Boolean) {
      value = defaultValue === 'true';
    }
    return value;
  }

  private _addOrUpdateElementViewModel(
    elementViewModel: ElementViewModel
  ): void {
    const state = this._elementViewModels$.getValue();
    const index = state.findIndex(
      viewModel => viewModel.element.id === elementViewModel.element.id
    );
    let newState = state.slice();
    if (index !== -1) {
      newState = removeObjectFromState(index, newState);
    }
    newState = addObjectToState(elementViewModel, newState);
    this._elementViewModels$.next(newState);
  }
}
