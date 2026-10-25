import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ConfirmProvider from './components/dialogs/ConfirmProvider.jsx';
import './styles/base.css';
import './styles/content.css';
import './styles/integrations.css';
import './styles/layout.css';
import './styles/widgets.css';

createRoot(document.getElementById('root')).render(<ConfirmProvider><App /></ConfirmProvider>);
