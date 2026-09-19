import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";

import { Budget, BudgetCopyRequest, BudgetWrite, DashboardPeriod } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class BudgetsService {
  private readonly http = inject(HttpClient);

  list(period: DashboardPeriod): Observable<Budget[]> {
    return this.http.get<Budget[]>("/api/budgets", { params: { year: period.year, month: period.month } });
  }

  upsert(categoryId: number, period: DashboardPeriod, payload: BudgetWrite): Observable<Budget> {
    return this.http.put<Budget>(`/api/budgets/${categoryId}`, payload, { params: { year: period.year, month: period.month } });
  }

  remove(categoryId: number, period: DashboardPeriod): Observable<void> {
    return this.http.delete<void>(`/api/budgets/${categoryId}`, { params: { year: period.year, month: period.month } });
  }

  copyPrevious(payload: BudgetCopyRequest): Observable<Budget[]> {
    return this.http.post<Budget[]>("/api/budgets/copy-previous", payload);
  }
}
