import axios from 'axios';
import { getApiBaseUrl } from './runtimeConfig';

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter = async () => null;

export function setApiTokenGetter(getter: TokenGetter): void {
  tokenGetter = getter;
}

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
});

apiClient.interceptors.request.use(async (config) => {
  const token = await tokenGetter();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});