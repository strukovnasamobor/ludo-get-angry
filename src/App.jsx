import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import MainMenu from './pages/MainMenu';
import GameSetup from './pages/GameSetup';
import GameBoard from './pages/GameBoard';
import Rules from './pages/Rules';
import Settings from './pages/Settings';
import Lobby from './pages/Lobby';
import LobbyRoom from './pages/LobbyRoom';
import OnlineGameBoard from './pages/OnlineGameBoard';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/"               element={<MainMenu />} />
              <Route path="/setup"          element={<GameSetup />} />
              <Route path="/game"           element={<GameBoard />} />
              <Route path="/rules"          element={<Rules />} />
              <Route path="/settings"       element={<Settings />} />
              <Route path="/lobby"          element={<Lobby />} />
              <Route path="/lobby/:roomId"  element={<LobbyRoom />} />
              <Route path="/online/:roomId" element={<OnlineGameBoard />} />
              <Route path="*"              element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}