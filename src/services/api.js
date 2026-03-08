import axios from 'axios';

import { clearToken, getToken } from './auth';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081';

export const api = axios.create({
  baseURL: apiBaseUrl,
});

api.interceptors.request.use((config) => {
  if (config.data instanceof FormData && config.headers) {
    // Let browser/axios set multipart boundary automatically.
    if (typeof config.headers.set === 'function') {
      config.headers.set('Content-Type', undefined);
    } else {
      delete config.headers['Content-Type'];
    }
  }

  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearToken();
    }
    return Promise.reject(error);
  }
);
