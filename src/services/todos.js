import { api } from './api';

export async function getTodos(scope = 'all') {
  const response = await api.get('/todos', {
    params: { scope },
  });
  return response.data;
}

export async function clearTodos(scope = 'all') {
  const response = await api.delete('/todos/clear', {
    params: { scope },
  });
  return response.data;
}

export async function completeTodo(todoId) {
  const response = await api.post(`/todos/${todoId}/complete`);
  return response.data;
}

export async function uploadTodoAttachment(todoId, file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post(`/todos/${todoId}/attachments/upload`, formData);
  return response.data;
}

export async function bulkImportTodos(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/todos/bulk-import', formData);
  return response.data;
}

export async function downloadBulkImportExample(format) {
  const path =
    format === 'json'
      ? '/todos/bulk-import/examples/json'
      : `/todos/bulk-import/examples/tabular?format=${encodeURIComponent(format)}`;

  return api.get(path, {
    responseType: 'blob',
  });
}

export async function downloadTodoAttachment(todoId, attachmentId) {
  return api.get(`/todos/${todoId}/attachments/${attachmentId}/download`, {
    responseType: 'blob',
  });
}
