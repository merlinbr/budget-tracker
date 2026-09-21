import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, catchError, from, map, mergeMap, of, throwError } from "rxjs";

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
    }).pipe(
      mergeMap((blob) => {
        if (!blob.type.toLowerCase().startsWith("application/json")) return of(blob);
        return this.decodeBlobError(new HttpErrorResponse({
          error: blob,
          status: 200,
          statusText: "OK",
        }));
      }),
      catchError((error: unknown) => this.decodeBlobError(error)),
    );
  }

  private decodeBlobError(error: unknown): Observable<never> {
    if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
      return throwError(() => error);
    }
    return from(error.error.text()).pipe(
      catchError(() => of<string | null>(null)),
      map((body) => {
        if (body === null) return error;
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return error;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !("error" in parsed)
        ) {
          return error;
        }
        const envelope = parsed.error;
        if (
          !envelope ||
          typeof envelope !== "object" ||
          Array.isArray(envelope) ||
          !("message" in envelope) ||
          typeof envelope.message !== "string"
        ) {
          return error;
        }
        return new HttpErrorResponse({
          error: parsed,
          headers: error.headers,
          status: error.status,
          statusText: error.statusText,
          url: error.url ?? undefined,
        });
      }),
      mergeMap((normalized) => throwError(() => normalized)),
    );
  }
}

