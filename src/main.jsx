import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/base.css';
import './styles/layout.css';
import './styles/content.css';
import './styles/widgets.css';
import './styles/integrations.css';

createRoot(document.getElementById('root')).render(<App />);
