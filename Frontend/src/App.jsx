import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from './api' // Импорт настроенного Axios из предыдущего шага
import './App.css' // Твои стили, переименованные

// Импорт созданных выше компонентов
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import DashboardTable from './components/DashboardTable'
import RequestCard from './components/RequestCard'

function App() {
	// ═════════════════════════════════════════════
	// ЛОГИКА И СОСТОЯНИЕ (useState Hooks)
	// ═════════════════════════════════════════════

	// 1. Состояние активного раздела меню (SPA навигация)
	// В script.js это делала функция navigateTo()
	const [activeSection, setActiveSection] = useState('home')

	// 2. Состояние для поиска (значение в инпуте)
	const [searchTerm, setSearchTerm] = useState('')

	// 3. Состояние модальных окон (открыто/закрыто)
	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
	const [selectedRequestId, setSelectedRequestId] = useState(null) // null = деталька закрыта

	// ═════════════════════════════════════════════
	// ЗАПРОСЫ К API (React Query)
	// ═════════════════════════════════════════════

	// Используем useQuery вместо fetch() внутри useEffect.
	// Это автоматически дает кэширование, статусы загрузки и обновления.
	const {
		data: requests,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ['requests'], // Ключ кэша
		queryFn: () => api.get('/requests').then(res => res.data), // Сама функция запроса
	})

	// ═════════════════════════════════════════════
	// ОБРАБОТЧИКИ СОБЫТИЙ (Functions)
	// ═════════════════════════════════════════════

	const handleRowClick = id => {
		console.log('Клик по заявке:', id)
		setSelectedRequestId(id) // Откроет модалку деталей (когда создадим компонент)
	}

	// ═════════════════════════════════════════════
	// ВЕРСТКА (JSX)
	// ═════════════════════════════════════════════
	return (
		<div className='app-wrapper'>
			<Header />

			<div className='body-row'>
				{/* В Sidebar нужно будет передать setActiveSection, чтобы менять разделы */}
				<Sidebar />

				<main className='main'>
					{/* ═════ РАЗДЕЛ: ГЛАВНАЯ (section-home) ═════ */}
					{/* В React используем условный рендеринг вместо добавления класса .active */}
					{activeSection === 'home' && (
						<section className='content-section active' id='section-home'>
							<div className='home-dashboard'>
								{/* Toolbar из index.html */}
								<div className='dashboard-toolbar'>
									<div className='dash-search-wrap'>
										<svg
											className='dash-search-icon'
											width='14'
											height='14'
											viewBox='0 0 24 24'
											fill='none'
											stroke='currentColor'
											strokeWidth='2.2'
										>
											<circle cx='11' cy='11' r='8' />
											<line x1='21' y1='21' x2='16.65' y2='16.65' />
										</svg>
										<input
											type='text'
											className='dash-search-input'
											placeholder='Поиск по клиенту...'
											value={searchTerm}
											onChange={e => setSearchTerm(e.target.value)} // Обработка ввода
										/>
									</div>
									<button className='export-btn'>
										{/* SVG иконка скачивания */}
										Скачать Excel
									</button>
								</div>

								{/* Обработка состояний загрузки */}
								{isLoading && (
									<div style={{ padding: 20, color: '#888' }}>
										Загрузка заявок...
									</div>
								)}
								{isError && (
									<div style={{ padding: 20, color: 'red' }}>
										Ошибка загрузки данных с бэкенда. Проверь CORS.
									</div>
								)}

								{/* Таблица. Передаем данные из API и функцию клика как пропсы */}
								{!isLoading && !isError && (
									<DashboardTable
										requests={requests}
										onRowClick={handleRowClick}
									/>
								)}
							</div>
						</section>
					)}

					{/* ═════ РАЗДЕЛ: ЗАЯВКИ (section-requests) ═════ */}
					{activeSection === 'requests' && (
						<section className='content-section active' id='section-requests'>
							<div className='requests-wrapper'>
								<div className='requests-list'>
									{/* Рендерим список карточек */}
									{requests?.map(req => (
										<RequestCard
											key={req.id}
											request={req}
											onClick={handleRowClick}
										/>
									))}

									{/* Если заявок нет */}
									{(!requests || requests.length === 0) && (
										<div className='requests-empty'>
											<div className='grey-block'>Нет заявок</div>
										</div>
									)}
								</div>

								<div className='requests-footer'>
									{/* Кнопка открытия модалки создания */}
									<button
										className='create-btn'
										onClick={() => setIsCreateModalOpen(true)}
									>
										Создать заявку
									</button>
								</div>
							</div>
						</section>
					)}

					{/* Остальные секции (Клиенты, Сотрудники) пока можно оставить заглушками */}
					{activeSection === 'clients' && (
						<section className='content-section active'>
							<h2>Клиенты (в разработке)</h2>
						</section>
					)}
				</main>
			</div>

			{/* ═════════════════════════════════════════════
          МОДАЛЬНЫЕ ОКНА (Появятся условно)
      ═════════════════════════════════════════════ */}
			{/* {isCreateModalOpen && <CreateRequestModal onClose={() => setIsCreateModalOpen(false)} />} */}
			{/* {selectedRequestId && <RequestDetailModal id={selectedRequestId} onClose={() => setSelectedRequestId(null)} />} */}
		</div>
	)
}

export default App
