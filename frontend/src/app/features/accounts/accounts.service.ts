import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";

import { Account, AccountWrite } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class AccountsService {
  private readonly http = inject(HttpClient);

  list(includeArchived = false) {
    return this.http.get<Account[]>("/api/accounts", { params: { includeArchived } });
  }

  get(id: number) {
    return this.http.get<Account>(`/api/accounts/${id}`);
  }

  create(body: AccountWrite) {
    return this.http.post<Account>("/api/accounts", body);
  }

  update(id: number, body: AccountWrite) {
    return this.http.put<Account>(`/api/accounts/${id}`, body);
  }

  archive(id: number) {
    return this.http.post<void>(`/api/accounts/${id}/archive`, null);
  }
}
