import axios from 'axios';

export interface Employee {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export type EmployeeInput = Omit<Employee, 'id' | 'created_at'>;

export interface EmployeePage {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
});

export const getEmployees = (page: number, limit: number, search: string) =>
  http.get<EmployeePage>('/employees', { params: { page, limit, search } }).then((r) => r.data);

export const createEmployee = (e: EmployeeInput) => http.post<Employee>('/employees', e);
export const updateEmployee = (id: number, e: EmployeeInput) => http.put<Employee>(`/employees/${id}`, e);
export const deleteEmployee = (id: number) => http.delete(`/employees/${id}`);

export const errorMessage = (err: unknown) =>
  axios.isAxiosError(err)
    ? err.response?.data?.error ?? 'Cannot reach the server. Is the API running?'
    : 'Unexpected error';
