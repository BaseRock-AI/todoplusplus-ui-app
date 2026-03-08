import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BrandHeader from '../components/BrandHeader';
import { clearToken } from '../services/auth';
import { api } from '../services/api';
import { isAdmin, roleLabel } from '../services/roles';
import {
  bulkImportTodos,
  clearTodos,
  completeTodo,
  getTodos,
  downloadBulkImportExample,
  downloadTodoAttachment,
  uploadTodoAttachment,
} from '../services/todos';

const ATTACHMENTS_STORAGE_KEY = 'todoplusplus_todo_attachments';
const TODO_SCOPE_ALL = 'all';
const TODO_SCOPE_DONE = 'done';
const TODO_SCOPE_PENDING = 'pending';

function normalizeAttachmentRecord(input) {
  if (!input || typeof input !== 'object') return null;

  const id = input.id ?? input.attachment_id ?? input.attachmentId;
  if (id === null || id === undefined || id === '') return null;

  const rawSize = input.size_bytes ?? input.sizeBytes;
  let sizeBytes = null;
  if (rawSize !== null && rawSize !== undefined && rawSize !== '') {
    const parsedSize = Number(rawSize);
    sizeBytes = Number.isFinite(parsedSize) ? parsedSize : null;
  }

  return {
    id,
    filename:
      input.filename ??
      input.attachment_filename ??
      input.attachmentFilename ??
      input.name ??
      '',
    content_type: input.content_type ?? input.contentType ?? '',
    size_bytes: sizeBytes,
  };
}

function dedupeAttachments(list) {
  const byId = new Map();
  for (const item of list || []) {
    const normalized = normalizeAttachmentRecord(item);
    if (!normalized) continue;
    byId.set(String(normalized.id), normalized);
  }
  return Array.from(byId.values());
}

function areAttachmentListsEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      String(a.id) !== String(b.id) ||
      a.filename !== b.filename ||
      a.content_type !== b.content_type ||
      a.size_bytes !== b.size_bytes
    ) {
      return false;
    }
  }
  return true;
}

function getStoredAttachments() {
  try {
    const raw = localStorage.getItem(ATTACHMENTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const cleaned = {};
    for (const [todoId, value] of Object.entries(parsed)) {
      let records = [];

      if (Array.isArray(value)) {
        records = dedupeAttachments(value);
      } else if (value && typeof value === 'object') {
        if (Array.isArray(value.attachments)) {
          records = dedupeAttachments(value.attachments);
        } else {
          const single = normalizeAttachmentRecord(value);
          records = single ? [single] : [];
        }
      }

      if (records.length > 0) {
        cleaned[todoId] = records;
      }
    }

    return cleaned;
  } catch (err) {
    return {};
  }
}

function getTodoAttachmentReferences(todo) {
  const collected = [];

  if (Array.isArray(todo?.attachments)) {
    collected.push(...todo.attachments);
  }

  if (todo?.attachment && typeof todo.attachment === 'object') {
    collected.push(todo.attachment);
  }

  const single = normalizeAttachmentRecord({
    id: todo?.attachment_id ?? todo?.attachmentId,
    filename: todo?.attachment_filename ?? todo?.attachmentFilename,
    content_type: todo?.attachment_content_type ?? todo?.attachmentContentType,
    size_bytes: todo?.attachment_size_bytes ?? todo?.attachmentSizeBytes,
  });
  if (single) {
    collected.push(single);
  }

  return dedupeAttachments(collected);
}

function getDetailMessage(detail) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (first && typeof first.msg === 'string' && first.msg.trim()) return first.msg;
  }
  return '';
}

function toFriendlyError(err, fallback, options = {}) {
  const status = err?.response?.status;
  if (status === 413) {
    return 'Upload failed: file is too large.';
  }
  if (status === 404) {
    return 'Resource not found. It may have been deleted or is no longer available.';
  }
  if (status === 422 && options.bulkImport) {
    return 'Bulk import failed: invalid file content. Use a valid .json, .csv, or .xlsx file.';
  }

  const detail = getDetailMessage(err?.response?.data?.detail);
  if (detail) return detail;

  if (!err?.response) {
    return 'Cannot reach backend. Check your network connection and API server.';
  }

  return fallback;
}

function decodeFilenamePart(rawValue) {
  const trimmed = String(rawValue || '').trim().replace(/^"(.*)"$/, '$1');
  if (!trimmed) return '';
  try {
    return decodeURIComponent(trimmed);
  } catch (err) {
    return trimmed;
  }
}

function getFilenameFromContentDisposition(contentDisposition) {
  if (typeof contentDisposition !== 'string') return '';

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeFilenamePart(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim().replace(/^"(.*)"$/, '$1');
  }

  return '';
}

function attachmentDownloadKey(todoId, attachmentId) {
  return `${todoId}:${attachmentId}`;
}

export default function TodoPage() {
  const navigate = useNavigate();
  const [todos, setTodos] = useState([]);
  const [text, setText] = useState('');
  const [user, setUser] = useState(null);
  const [pendingRequestsByTodoId, setPendingRequestsByTodoId] = useState({});
  const [selectedFilesByTodoId, setSelectedFilesByTodoId] = useState({});
  const [attachmentsByTodoId, setAttachmentsByTodoId] = useState(() => getStoredAttachments());
  const [downloadingByKey, setDownloadingByKey] = useState({});
  const [bulkImportFile, setBulkImportFile] = useState(null);
  const [bulkImportLoading, setBulkImportLoading] = useState(false);
  const [bulkImportSampleFormat, setBulkImportSampleFormat] = useState('csv');
  const [bulkSampleDownloadLoading, setBulkSampleDownloadLoading] = useState(false);
  const [bulkImportMessage, setBulkImportMessage] = useState('');
  const [bulkImportMessageType, setBulkImportMessageType] = useState('info');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageType, setMessageType] = useState('info');
  const [activeScope, setActiveScope] = useState(TODO_SCOPE_ALL);
  const bulkImportInputRef = useRef(null);
  const attachmentInputRefs = useRef({});
  const isBusy = loading || bulkImportLoading;

  const sortedTodos = useMemo(
    () => [...todos].sort((a, b) => Number(a.completed) - Number(b.completed) || a.id - b.id),
    [todos]
  );

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ATTACHMENTS_STORAGE_KEY, JSON.stringify(attachmentsByTodoId));
    } catch (err) {
      // Ignore storage write failures and continue with in-memory state.
    }
  }, [attachmentsByTodoId]);

  function setAttachmentInputRef(todoId, node) {
    const key = String(todoId);
    if (node) {
      attachmentInputRefs.current[key] = node;
      return;
    }
    delete attachmentInputRefs.current[key];
  }

  function clearSelectedUploadFile(todoId) {
    setSelectedFilesByTodoId((prev) => {
      if (!(todoId in prev)) return prev;
      const next = { ...prev };
      delete next[todoId];
      return next;
    });

    const inputNode = attachmentInputRefs.current[String(todoId)];
    if (inputNode) {
      inputNode.value = '';
    }
  }

  function getAttachmentList(todoId) {
    return attachmentsByTodoId[String(todoId)] || [];
  }

  function getLatestAttachment(todoId) {
    const list = getAttachmentList(todoId);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  function isDownloadingAttachment(todoId, attachmentId) {
    return Boolean(downloadingByKey[attachmentDownloadKey(todoId, attachmentId)]);
  }

  function setAttachmentsForTodo(todoId, attachments) {
    const key = String(todoId);
    const nextAttachments = dedupeAttachments(attachments);

    setAttachmentsByTodoId((prev) => {
      const prevAttachments = prev[key] || [];

      if (nextAttachments.length === 0) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }

      if (areAttachmentListsEqual(prevAttachments, nextAttachments)) {
        return prev;
      }

      return {
        ...prev,
        [key]: nextAttachments,
      };
    });
  }

  function appendAttachmentForTodo(todoId, attachment) {
    const key = String(todoId);
    const normalized = normalizeAttachmentRecord(attachment);
    if (!normalized) return;

    setAttachmentsByTodoId((prev) => {
      const prevAttachments = prev[key] || [];
      const nextAttachments = dedupeAttachments([...prevAttachments, normalized]);
      if (areAttachmentListsEqual(prevAttachments, nextAttachments)) {
        return prev;
      }
      return {
        ...prev,
        [key]: nextAttachments,
      };
    });
  }

  function updateAttachmentFilename(todoId, attachmentId, filename) {
    if (!filename) return;

    const key = String(todoId);
    setAttachmentsByTodoId((prev) => {
      const list = prev[key];
      if (!Array.isArray(list) || list.length === 0) return prev;

      let changed = false;
      const nextList = list.map((item) => {
        if (String(item.id) !== String(attachmentId) || item.filename === filename) {
          return item;
        }
        changed = true;
        return { ...item, filename };
      });

      return changed
        ? {
            ...prev,
            [key]: nextList,
          }
        : prev;
    });
  }

  function mergeAttachmentReferences(todoList) {
    setAttachmentsByTodoId((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const todo of todoList || []) {
        const referenced = getTodoAttachmentReferences(todo);
        if (referenced.length === 0) continue;

        const key = String(todo.id);
        const merged = dedupeAttachments([...(next[key] || []), ...referenced]);
        const prevList = next[key] || [];

        if (!areAttachmentListsEqual(prevList, merged)) {
          next[key] = merged;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }

  async function bootstrap() {
    try {
      const [meRes, todosRes] = await Promise.all([api.get('/auth/me'), getTodos(activeScope)]);
      setUser(meRes.data);
      setTodos(todosRes);
      mergeAttachmentReferences(todosRes);
      await refreshPendingDeleteRequests(meRes.data);
    } catch (err) {
      clearToken();
      navigate('/');
    }
  }

  async function refreshPendingDeleteRequests(currentUser = user) {
    if (!currentUser) return;
    try {
      const deleteRequestsRes = await api.get('/delete-requests', { params: { status: 'PENDING' } });
      const nextByTodoId = {};
      for (const item of deleteRequestsRes.data || []) {
        nextByTodoId[item.todo_id] = item;
      }
      setPendingRequestsByTodoId(nextByTodoId);
    } catch (err) {
      setPendingRequestsByTodoId({});
    }
  }

  async function refreshTodos(scope = activeScope) {
    const [todosRes] = await Promise.all([getTodos(scope), refreshPendingDeleteRequests()]);
    setTodos(todosRes);
    mergeAttachmentReferences(todosRes);
  }

  async function addTodo() {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      await api.post('/todos', { name: trimmed, completed: false });
      setText('');
      await refreshTodos();
      setMessage('Todo added.');
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to add todo.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete(todo) {
    if (isBusy) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      if (todo.completed) {
        await api.put(`/todos/${todo.id}`, { completed: false });
      } else {
        await completeTodo(todo.id);
      }
      await refreshTodos();
      setMessage(
        todo.completed
          ? `Todo #${todo.id} moved back to pending.`
          : `Todo #${todo.id} marked as done.`
      );
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to update todo status.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadAttachment(todo) {
    if (isBusy) return;

    const file = selectedFilesByTodoId[todo.id];
    if (!file) {
      setMessageType('error');
      setMessage(`Select a file first for todo #${todo.id}.`);
      return;
    }

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      const uploaded = await uploadTodoAttachment(todo.id, file);
      appendAttachmentForTodo(todo.id, uploaded);
      clearSelectedUploadFile(todo.id);
      setMessage(`Attachment uploaded for todo #${todo.id}.`);
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to upload attachment.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadAttachment(todo, attachment) {
    if (!attachment?.id || isBusy || isDownloadingAttachment(todo.id, attachment.id)) return;

    const downloadKey = attachmentDownloadKey(todo.id, attachment.id);
    setDownloadingByKey((prev) => ({ ...prev, [downloadKey]: true }));
    setMessage('');
    setMessageType('info');

    try {
      const response = await downloadTodoAttachment(todo.id, attachment.id);
      const contentDisposition =
        response?.headers?.['content-disposition'] || response?.headers?.['Content-Disposition'];
      const filenameFromHeader = getFilenameFromContentDisposition(contentDisposition);
      const finalFilename = filenameFromHeader || attachment.filename || `todo-${todo.id}-attachment-${attachment.id}`;

      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = finalFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);

      updateAttachmentFilename(todo.id, attachment.id, finalFilename);
      setMessage(`Attachment downloaded for todo #${todo.id}.`);
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to download attachment.'));
    } finally {
      setDownloadingByKey((prev) => {
        const next = { ...prev };
        delete next[downloadKey];
        return next;
      });
    }
  }

  async function removeTodo(todo) {
    if (isBusy) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      const response = await api.delete(`/todos/${todo.id}`);
      await refreshTodos();

      if (response?.data?.action === 'PENDING') {
        setMessage(`Delete request submitted for todo #${todo.id}. Admin approval required.`);
        const requestId = response?.data?.delete_request_id;
        if (requestId) {
          setPendingRequestsByTodoId((prev) => ({
            ...prev,
            [todo.id]: {
              id: requestId,
              todo_id: todo.id,
              status: 'PENDING',
            },
          }));
        }
      } else if (response?.data?.action === 'pending_approval') {
        setMessage(`Delete request already pending for todo #${todo.id}.`);
        const requestId = response?.data?.delete_request_id;
        if (requestId) {
          setPendingRequestsByTodoId((prev) => ({
            ...prev,
            [todo.id]: {
              id: requestId,
              todo_id: todo.id,
              status: 'PENDING',
            },
          }));
        }
      } else {
        setMessage(`Todo #${todo.id} deleted.`);
        clearSelectedUploadFile(todo.id);
        setAttachmentsForTodo(todo.id, []);
      }
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to delete todo.'));
    } finally {
      setLoading(false);
    }
  }

  async function decideDeleteRequest(todoId, requestId, decision) {
    if (isBusy) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      await api.post(`/delete-requests/${requestId}/${decision}`);
      await refreshTodos();
      setMessage(
        decision === 'approve'
          ? `Delete request approved for todo #${todoId}.`
          : `Delete request rejected for todo #${todoId}.`
      );
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, `Failed to ${decision} delete request.`));
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkImport() {
    if (!bulkImportFile || isBusy) return;

    setBulkImportLoading(true);
    setBulkImportMessage('');
    setBulkImportMessageType('info');

    try {
      const result = await bulkImportTodos(bulkImportFile);
      await refreshTodos();
      setBulkImportFile(null);
      if (bulkImportInputRef.current) {
        bulkImportInputRef.current.value = '';
      }

      const createdCount = Number.isFinite(Number(result?.created_count))
        ? Number(result.created_count)
        : 0;
      setBulkImportMessage(`Bulk import complete: ${createdCount} todos created.`);
    } catch (err) {
      setBulkImportMessageType('error');
      setBulkImportMessage(toFriendlyError(err, 'Bulk import failed.', { bulkImport: true }));
    } finally {
      setBulkImportLoading(false);
    }
  }

  async function handleDownloadBulkImportSample() {
    if (isBusy || bulkSampleDownloadLoading) return;

    setBulkSampleDownloadLoading(true);
    setBulkImportMessage('');
    setBulkImportMessageType('info');

    try {
      const response = await downloadBulkImportExample(bulkImportSampleFormat);
      const contentDisposition =
        response?.headers?.['content-disposition'] || response?.headers?.['Content-Disposition'];
      const filenameFromHeader = getFilenameFromContentDisposition(contentDisposition);
      const fallbackFilename = `bulk-import-sample.${bulkImportSampleFormat}`;
      const finalFilename = filenameFromHeader || fallbackFilename;

      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = finalFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setBulkImportMessageType('error');
      setBulkImportMessage(toFriendlyError(err, 'Failed to download sample file.'));
    } finally {
      setBulkSampleDownloadLoading(false);
    }
  }

  function creatorLabel(todo) {
    const rawRole =
      todo?.created_by_role ||
      todo?.creator_role ||
      todo?.createdByRole ||
      todo?.created_by?.role ||
      todo?.creator?.role;

    return roleLabel(rawRole);
  }

  function hasPendingDeleteRequest(todoId) {
    return Boolean(pendingRequestsByTodoId[todoId]);
  }

  function onTextareaKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addTodo();
    }
  }

  function scopeDisplayText(scope) {
    if (scope === TODO_SCOPE_DONE) return 'done';
    if (scope === TODO_SCOPE_PENDING) return 'pending';
    return 'all';
  }

  async function handleScopeFilterChange(scope) {
    if (isBusy || scope === activeScope) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      await refreshTodos(scope);
      setActiveScope(scope);
      setMessage(`Showing ${scopeDisplayText(scope)} todos.`);
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to load todos for selected scope.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleClearScope(scope) {
    if (isBusy) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      const result = await clearTodos(scope);
      await refreshTodos();

      const deletedCount = Number.isFinite(Number(result?.deleted_count))
        ? Number(result.deleted_count)
        : 0;
      const resolvedScope = scopeDisplayText(result?.scope || scope);

      if (resolvedScope === TODO_SCOPE_ALL) {
        setAttachmentsByTodoId({});
        setSelectedFilesByTodoId({});
      }

      setMessage(`Cleared ${deletedCount} ${resolvedScope} todo${deletedCount === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessageType('error');
      setMessage(toFriendlyError(err, 'Failed to clear todos.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page app-shell">
      <BrandHeader
        onLogout={() => setUser(null)}
        userText={user ? `Logged in as ${user.username} (${roleLabel(user)})` : 'Loading user...'}
      />

      <section className="panel todo-panel">
        <h1 className="page-title page-title-center">ToDo ++</h1>

        <div className="todo-input-wrap">
          <textarea
            id="todo-input"
            placeholder="Enter submits. Shift+Enter adds a new line."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
          />
          <button className="primary-btn" onClick={addTodo} disabled={isBusy || !text.trim()}>
            {loading ? 'Please wait...' : 'Enter'}
          </button>
        </div>

        <div className="bulk-import-wrap">
          <div className="bulk-import-controls">
            <div className="bulk-import-upload-group">
              <label htmlFor="bulk-import-input" className="bulk-import-label">
                Bulk Import
              </label>
              <input
                id="bulk-import-input"
                ref={bulkImportInputRef}
                type="file"
                accept=".json,.csv,.xlsx"
                onChange={(e) => {
                  setBulkImportFile(e.target.files?.[0] || null);
                  setBulkImportMessage('');
                  setBulkImportMessageType('info');
                }}
                disabled={isBusy}
              />
              <button
                className="ghost-btn"
                onClick={handleBulkImport}
                disabled={isBusy || bulkSampleDownloadLoading || !bulkImportFile}
              >
                {bulkImportLoading ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            <div className="bulk-import-sample-group">
              <select
                className="bulk-import-select"
                value={bulkImportSampleFormat}
                onChange={(e) => setBulkImportSampleFormat(e.target.value)}
                disabled={isBusy || bulkSampleDownloadLoading}
                aria-label="Sample file format"
              >
                <option value="csv">Sample CSV</option>
                <option value="xlsx">Sample XLSX</option>
                <option value="json">Sample JSON</option>
              </select>
              <button
                className="ghost-btn"
                onClick={handleDownloadBulkImportSample}
                disabled={isBusy || bulkSampleDownloadLoading}
              >
                {bulkSampleDownloadLoading ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </div>
          <p className="bulk-import-hint">Supports .json, .csv, and .xlsx files.</p>
          {bulkImportMessage ? (
            <p className={`message-text ${bulkImportMessageType === 'error' ? 'message-error' : 'message-info'}`}>
              {bulkImportMessage}
            </p>
          ) : null}
        </div>

        {message ? (
          <p className={`message-text ${messageType === 'error' ? 'message-error' : 'message-info'}`}>
            {message}
          </p>
        ) : null}

        <div className="table-toolbar">
          <div className="table-toolbar-group table-toolbar-left">
            <button
              className={`ghost-btn table-toolbar-btn ${activeScope === TODO_SCOPE_ALL ? 'table-toolbar-btn-active' : ''}`}
              onClick={() => handleScopeFilterChange(TODO_SCOPE_ALL)}
              disabled={isBusy}
            >
              Show all
            </button>
            <button
              className={`ghost-btn table-toolbar-btn ${activeScope === TODO_SCOPE_DONE ? 'table-toolbar-btn-active' : ''}`}
              onClick={() => handleScopeFilterChange(TODO_SCOPE_DONE)}
              disabled={isBusy}
            >
              Show done
            </button>
            <button
              className={`ghost-btn table-toolbar-btn ${activeScope === TODO_SCOPE_PENDING ? 'table-toolbar-btn-active' : ''}`}
              onClick={() => handleScopeFilterChange(TODO_SCOPE_PENDING)}
              disabled={isBusy}
            >
              Show pending
            </button>
          </div>

          <div className="table-toolbar-group table-toolbar-right">
            <button
              className="ghost-btn table-toolbar-btn table-toolbar-btn-danger"
              onClick={() => handleClearScope(TODO_SCOPE_ALL)}
              disabled={isBusy}
            >
              Clear all
            </button>
            <button
              className="ghost-btn table-toolbar-btn table-toolbar-btn-danger"
              onClick={() => handleClearScope(TODO_SCOPE_DONE)}
              disabled={isBusy}
            >
              Clear done
            </button>
            <button
              className="ghost-btn table-toolbar-btn table-toolbar-btn-danger"
              onClick={() => handleClearScope(TODO_SCOPE_PENDING)}
              disabled={isBusy}
            >
              Clear pending
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>ToDo Item</th>
                <th>Created By</th>
                <th>Task Status</th>
                <th>Complete</th>
                <th>Delete</th>
                <th>Supporting Document</th>
              </tr>
            </thead>
            <tbody>
              {sortedTodos.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-row">
                    No todos yet.
                  </td>
                </tr>
              ) : (
                sortedTodos.map((todo) => {
                  const attachments = getAttachmentList(todo.id);
                  const latestAttachment = getLatestAttachment(todo.id);
                  const selectedFile = selectedFilesByTodoId[todo.id];

                  return (
                    <tr key={todo.id} className={todo.completed ? 'done-row' : ''}>
                      <td>{todo.id}</td>
                      <td className="todo-text">
                        <span className="todo-text-main">{todo.name}</span>
                        {!isAdmin(user) ? (
                          hasPendingDeleteRequest(todo.id) ? (
                            <span className="delete-request-note">(delete request sent to admin)</span>
                          ) : null
                        ) : null}
                      </td>
                      <td className="creator-cell">{creatorLabel(todo)}</td>
                      <td>
                        <span className={`status-pill ${todo.completed ? 'status-done' : 'status-pending'}`}>
                          {todo.completed ? 'Done' : 'Pending'}
                        </span>
                      </td>
                      <td>
                        <div className="complete-cell-wrap">
                          <button
                            className={`icon-btn ${todo.completed ? 'icon-undo' : 'icon-done'}`}
                            onClick={() => handleComplete(todo)}
                            aria-label={todo.completed ? `Undo todo ${todo.id}` : `Mark todo ${todo.id} done`}
                            disabled={isBusy}
                            title={todo.completed ? 'Move back to pending' : 'Complete'}
                          >
                            {todo.completed ? '↺' : '✓'}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="delete-cell-wrap">
                          <button
                            className="icon-btn icon-delete"
                            onClick={() => removeTodo(todo)}
                            aria-label={`Delete todo ${todo.id}`}
                            disabled={isBusy}
                          >
                            ✕
                          </button>
                          {isAdmin(user) && hasPendingDeleteRequest(todo.id) ? (
                            <div className="decision-actions">
                              <button
                                className="decision-btn decision-approve"
                                onClick={() =>
                                  decideDeleteRequest(todo.id, pendingRequestsByTodoId[todo.id].id, 'approve')
                                }
                                disabled={isBusy}
                              >
                                Approve
                              </button>
                              <button
                                className="decision-btn decision-reject"
                                onClick={() =>
                                  decideDeleteRequest(todo.id, pendingRequestsByTodoId[todo.id].id, 'reject')
                                }
                                disabled={isBusy}
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="supporting-doc-wrap">
                          <div className="doc-upload-row">
                            <input
                              type="file"
                              className="row-file-input"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) {
                                  clearSelectedUploadFile(todo.id);
                                  return;
                                }
                                setSelectedFilesByTodoId((prev) => ({ ...prev, [todo.id]: file }));
                              }}
                              disabled={isBusy}
                              aria-label={`Attachment for todo ${todo.id}`}
                              ref={(node) => setAttachmentInputRef(todo.id, node)}
                            />
                            <div className="doc-action-row">
                              <button
                                className="icon-btn doc-action-btn"
                                onClick={() => handleUploadAttachment(todo)}
                                disabled={isBusy || !selectedFile}
                                aria-label={`Upload attachment for todo ${todo.id}`}
                                title="Upload selected file"
                              >
                                ⬆
                              </button>
                              <button
                                className="icon-btn doc-action-btn"
                                onClick={() => latestAttachment && handleDownloadAttachment(todo, latestAttachment)}
                                disabled={
                                  isBusy ||
                                  !latestAttachment ||
                                  isDownloadingAttachment(todo.id, latestAttachment.id)
                                }
                                aria-label={`Download latest attachment for todo ${todo.id}`}
                                title="Download latest attachment"
                              >
                                {latestAttachment && isDownloadingAttachment(todo.id, latestAttachment.id) ? '...' : '⬇'}
                              </button>
                            </div>
                          </div>

                          {attachments.length > 0 ? (
                            <div className="attachment-list">
                              {attachments.map((attachment) => (
                                <div className="attachment-row" key={attachment.id}>
                                  <span className="attachment-name">
                                    {attachment.filename || `Attachment #${attachment.id}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="selected-file-hint">No attachment</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
