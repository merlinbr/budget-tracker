import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";

import { Transaction, TransactionFilters, TransactionWrite } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  list(filters: TransactionFilters) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params = params.set(key, value);
    }
    return this.http.get<Transaction[]>("/api/transactions", { params });
  }

  get(id: number) {
    return this.http.get<Transaction>(`/api/transactions/${id}`);
  }

  create(body: TransactionWrite) {
    return this.http.post<Transaction>("/api/transactions", body);
  }

  update(id: number, body: TransactionWrite) {
    return this.http.put<Transaction>(`/api/transactions/${id}`, body);
  }

  remove(id: number) {
    return this.http.delete<void>(`/api/transactions/${id}`);
  }
}
