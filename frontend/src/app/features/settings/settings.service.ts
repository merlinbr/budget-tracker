import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";

import { ExportFilters, HouseholdDetails } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class SettingsService {
  private readonly http = inject(HttpClient);

  household(): Observable<HouseholdDetails> {
    return this.http.get<HouseholdDetails>("/api/household");
  }

  exportTransactions(filters: ExportFilters): Observable<Blob> {
    const params: Record<string, string | number> = {};
    if (filters.from !== undefined) params["from"] = filters.from;
    if (filters.to !== undefined) params["to"] = filters.to;
    if (filters.accountId !== undefined) params["accountId"] = filters.accountId;
    if (filters.categoryId !== undefined) params["categoryId"] = filters.categoryId;
    return this.http.get("/api/export/transactions.csv", {
      params,
      responseType: "blob",
    });
  }
}
