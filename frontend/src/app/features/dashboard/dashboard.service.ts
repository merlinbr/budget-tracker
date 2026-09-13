import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";

import { DashboardResponse } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class DashboardService {
  private readonly http = inject(HttpClient);

  get(year: number, month: number): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>("/api/dashboard", { params: { year, month } });
  }
}