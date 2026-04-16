import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom' // <-- Импортируем Роутер
import App from './App.jsx'
import './index.css' // Подключаем наши зеленые стили

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Оборачиваем App в BrowserRouter */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)