import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BrandHeader from '../components/BrandHeader';
import { clearToken } from '../services/auth';
import { api } from '../services/api';

export default function TodoPage() {
  const navigate = useNavigate();
  const [todos, setTodos] = useState([]);
  const [text, setText] = useState('');
  const [user, setUser] = useState(null);
  const [pendingRequestsByTodoId, setPendingRequestsByTodoId] = useState({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageType, setMessageType] = useState('info');

  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => Number(a.completed) - Number(b.completed) || a.id - b.id);
  }, [todos]);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const [meRes, todosRes] = await Promise.all([api.get('/auth/me'), api.get('/todos')]);
      setUser(meRes.data);
      setTodos(todosRes.data);
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
      // Non-fatal for current UI: todo table can still render without delete request metadata.
      setPendingRequestsByTodoId({});
    }
  }

  async function refreshTodos() {
    const [todosRes] = await Promise.all([api.get('/todos'), refreshPendingDeleteRequests()]);
    setTodos(todosRes.data);
  }

  async function addTodo() {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

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
      setMessage(err?.response?.data?.detail || 'Failed to add todo.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleComplete(todo) {
    if (loading) return;

    setLoading(true);
    setMessage('');
    setMessageType('info');
    try {
      const nextCompleted = !todo.completed;
      await api.put(`/todos/${todo.id}`, { completed: nextCompleted });
      await refreshTodos();
      setMessage(nextCompleted ? `Todo #${todo.id} marked as done.` : `Todo #${todo.id} moved back to pending.`);
    } catch (err) {
      setMessageType('error');
      setMessage(err?.response?.data?.detail || 'Failed to update todo.');
    } finally {
      setLoading(false);
    }
  }

  async function removeTodo(todo) {
    if (loading) return;

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
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err?.response?.data?.detail || 'Failed to delete todo.');
    } finally {
      setLoading(false);
    }
  }

  async function decideDeleteRequest(todoId, requestId, decision) {
    if (loading) return;

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
      setMessage(err?.response?.data?.detail || `Failed to ${decision} delete request.`);
    } finally {
      setLoading(false);
    }
  }

  function creatorLabel(todo) {
    const rawRole =
      todo?.created_by_role ||
      todo?.creator_role ||
      todo?.createdByRole ||
      todo?.created_by?.role ||
      todo?.creator?.role;

    if (typeof rawRole === 'string') {
      const normalized = rawRole.toLowerCase();
      if (normalized === 'admin') return 'Admin';
      if (normalized === 'user') return 'User';
    }
    return 'N/A';
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

  return (
    <main className="page app-shell">
      <BrandHeader
        onLogout={() => setUser(null)}
        userText={user ? `Logged in as ${user.username} (${user.role})` : 'Loading user...'}
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
          <button className="primary-btn" onClick={addTodo} disabled={loading || !text.trim()}>
            {loading ? 'Please wait...' : 'Enter'}
          </button>
        </div>

        {message ? <p className={`message-text ${messageType === 'error' ? 'message-error' : 'message-info'}`}>{message}</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>ToDo Item</th>
                <th>Created By</th>
                <th>Task Status</th>
                <th aria-label="complete action" />
                <th aria-label="delete action" />
              </tr>
            </thead>
            <tbody>
              {sortedTodos.length === 0 ? (
                <tr>
                  <td colSpan="6" className="empty-row">
                    No todos yet.
                  </td>
                </tr>
              ) : (
                sortedTodos.map((todo) => (
                  <tr key={todo.id} className={todo.completed ? 'done-row' : ''}>
                    <td>{todo.id}</td>
                    <td className="todo-text">
                      <span className="todo-text-main">{todo.name}</span>
                      {!user || user.role !== 'admin' ? (
                        hasPendingDeleteRequest(todo.id) ? (
                          <span className="delete-request-note">(delete request sent to admin)</span>
                        ) : null
                      ) : null}
                    </td>
                    <td>{creatorLabel(todo)}</td>
                    <td>
                      <span className={`status-pill ${todo.completed ? 'status-done' : 'status-pending'}`}>
                        {todo.completed ? 'Done' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`icon-btn ${todo.completed ? 'icon-undo' : 'icon-done'}`}
                        onClick={() => toggleComplete(todo)}
                        aria-label={todo.completed ? `Undo todo ${todo.id}` : `Mark todo ${todo.id} done`}
                      >
                        {todo.completed ? '↺' : '✓'}
                      </button>
                    </td>
                    <td>
                      <div className="delete-cell-wrap">
                        <button
                          className="icon-btn icon-delete"
                          onClick={() => removeTodo(todo)}
                          aria-label={`Delete todo ${todo.id}`}
                        >
                          ✕
                        </button>
                        {user?.role === 'admin' && hasPendingDeleteRequest(todo.id) ? (
                          <div className="decision-actions">
                            <button
                              className="decision-btn decision-approve"
                              onClick={() =>
                                decideDeleteRequest(todo.id, pendingRequestsByTodoId[todo.id].id, 'approve')
                              }
                              disabled={loading}
                            >
                              Approve
                            </button>
                            <button
                              className="decision-btn decision-reject"
                              onClick={() =>
                                decideDeleteRequest(todo.id, pendingRequestsByTodoId[todo.id].id, 'reject')
                              }
                              disabled={loading}
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
