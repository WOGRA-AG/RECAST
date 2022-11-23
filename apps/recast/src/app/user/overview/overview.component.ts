import { Component } from '@angular/core';

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent {
  public tabs: string[] = ['Prozesse', 'Bundles', 'Bauteile'];

  public changeContent(index: number): void {
    //TODO
  }
}
