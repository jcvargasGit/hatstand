import '@fontsource-variable/figtree';
import '@fontsource-variable/jetbrains-mono';
import '@xterm/xterm/css/xterm.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { NewTaskWindow } from './components/NewTaskWindow';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The root element is missing.');

const newTaskDraftId = new URLSearchParams(window.location.search).get('new-task');

createRoot(root).render(<StrictMode>{newTaskDraftId ? <NewTaskWindow draftId={newTaskDraftId} /> : <App />}</StrictMode>);
