import { Component, OnDestroy } from '@angular/core';
import { Breadcrumb } from '@wogra/wogra-ui-kit';
import { yamlToProcess$ } from '../../shared/util/common-utils';
import { catchError, of, Subject, switchMap, take, takeUntil } from 'rxjs';
import { Router } from '@angular/router';
import { AlertService } from '../../services/alert.service';
import { BundleService } from '../../services';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { fileExtensionValidator } from '@wogra/wogra-ui-kit';

@Component({
  selector: 'app-bundle-new',
  templateUrl: './bundle-new.component.html',
  styleUrls: ['./bundle-new.component.scss'],
})
export class BundleNewComponent implements OnDestroy {
  public breadcrumbs: Breadcrumb[] = [
    { label: $localize`:@@header.overview:Overview`, link: '/overview' },
    { label: $localize`:@@header.new_bundle:New Bundle` },
  ];
  protected loading = false;
  protected file: File | undefined;
  protected formGroup: FormGroup = new FormGroup({
    file: new FormControl('', [
      Validators.required,
      fileExtensionValidator(['yaml', 'yml', 'json']),
    ]),
  });
  private _destroy$: Subject<void> = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly alert: AlertService,
    private readonly bundleService: BundleService
  ) {
    const fileForm = this.formGroup.get('file');
    fileForm?.valueChanges.pipe(takeUntil(this._destroy$)).subscribe(value => {
      this.file = value;
    });
  }

  public uploadFile(): void {
    if (!this.file) {
      return;
    }
    this.loading = true;
    const bundleName = this.file.name.split('.')[0];
    yamlToProcess$(this.file)
      .pipe(
        take(1),
        switchMap(procs =>
          this.bundleService.saveProcessesAsBundle$(bundleName, procs)
        ),
        catchError((err: Error) => {
          this.alert.reportError(err.message);
          return of(undefined);
        })
      )
      .subscribe(bundle => {
        this.loading = false;
        if (!bundle) {
          return;
        }
        this.cancel();
      });
  }

  public cancel(): void {
    this.router.navigate(['']);
  }

  public ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
