import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Clients from './components/Clients'
import Approvals from './components/Approvals'
import Entrance from './components/Entrance'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import Requests from './components/Requests'
import Employees from './components/Employees'
import Trash from './components/Trash'
import Warehouse from './components/Warehouse'
import Settings from './components/Settings'
import Prices from './components/Prices'
import MyInventory from './components/MyInventory'
import Inventory from './components/Inventory'
import Reports from './components/Reports'
import NewRequestNotice from './components/notifications/NewRequestNotice'
import Calendar from './components/Calendar'
import SupportRequests from './components/SupportRequests'
import PortalApp from './components/portal/PortalApp'

import ProtectedRoute from './components/ProtectedRoute'
import AccessDenied from './components/AccessDenied'
import {
	API_BASE_URL,
	clearAuthData,
	getAuthHeaders,
	isTokenExpired,
} from './api'
import {
	getStoredUser,
	isClientPortalUser,
	resolveLandingRoute,
	setStoredUser,
} from './utils/access'

// Куда отправлять человека, когда конкретный маршрут не указан.
// Жёсткий /requests уводил бы сотрудника без requests.view на AccessDenied.
const LandingRedirect = () => <Navigate to={resolveLandingRoute()} replace />

export default function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false)
	const [isLoading, setIsLoading] = useState(true)
	const [currentUser, setCurrentUser] = useState(null)

	useEffect(() => {
		const bootstrap = async () => {
			const token = localStorage.getItem('access_token')
			const storedUser = getStoredUser()

			// Одного токена мало: без user_data все проверки прав дают false,
			// и человек оказывается формально вошедшим, но запертым на AccessDenied.
			if (!token || isTokenExpired(token) || !storedUser?.id) {
				clearAuthData()
				setIsAuthenticated(false)
				setIsLoading(false)
				return
			}

			setCurrentUser(storedUser)

			// Спрашиваем сервер о себе при каждом старте.
			//
			// Две причины. Первая: /auth/login отдаёт права один раз, а токен
			// живёт часами — снятое в Settings право иначе продолжало бы
			// действовать на фронте до перелогина. Вторая: тип учётной записи
			// решает, какую оболочку показывать, и такая развилка не должна
			// опираться на данные в localStorage.
			try {
				const res = await fetch(`${API_BASE_URL}/auth/me`, {
					headers: getAuthHeaders(),
				})

				// 401 — токен недействителен, 403 — учётку отключили, роль
				// выключили или клиента убрали в корзину. В обоих случаях
				// сессии больше нет.
				if (res.status === 401 || res.status === 403) {
					clearAuthData()
					setIsAuthenticated(false)
					setIsLoading(false)
					return
				}

				if (res.ok) {
					const freshUser = await res.json()

					// Слияние, а не замена: если /auth/me когда-нибудь начнёт
					// отдавать меньше полей, мы не потеряем то, что положил вход.
					const mergedUser = { ...storedUser, ...freshUser }

					setStoredUser(mergedUser)
					setCurrentUser(mergedUser)
				}
			} catch (err) {
				// Сеть недоступна — работаем на сохранённых данных.
				// Выкидывать человека из системы из-за обрыва связи нельзя.
				console.error('Не удалось обновить данные пользователя:', err)
			}

			setIsAuthenticated(true)
			setIsLoading(false)
		}

		bootstrap()
	}, [])

	if (isLoading) return null

	if (!isAuthenticated) {
		return <Entrance />
	}

	// Развилка стоит выше оболочки: у клиента не «пустой сайдбар», а другое
	// приложение. Маршруты сотрудников для него не объявлены вовсе, поэтому
	// прямой заход на /warehouse попадёт в '*' и вернёт в кабинет.
	if (isClientPortalUser(currentUser)) {
		return <PortalApp user={currentUser} />
	}

	return (
		<div className='crm-app'>
			<Header />
			<NewRequestNotice />

			<div className='body-row'>
				<Sidebar />

				<main className='main'>
					<section
						className='content-section active'
						style={{ display: 'block', overflowY: 'auto', width: '100%' }}
					>
						<Routes>
							<Route path='/' element={<LandingRedirect />} />

							<Route path='/login' element={<LandingRedirect />} />

							<Route path='/access-denied' element={<AccessDenied />} />

							<Route
								path='/calendar'
								element={
									<ProtectedRoute routeKey='calendar'>
										<Calendar />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/requests'
								element={
									<ProtectedRoute routeKey='requests'>
										<Requests />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/support-requests'
								element={
									<ProtectedRoute routeKey='support_requests'>
										<SupportRequests />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/clients'
								element={
									<ProtectedRoute routeKey='clients'>
										<Clients />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/prices'
								element={
									<ProtectedRoute routeKey='prices'>
										<Prices />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/employees'
								element={
									<ProtectedRoute routeKey='employees'>
										<Employees />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/approvals'
								element={
									<ProtectedRoute routeKey='approvals'>
										<Approvals />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/warehouse'
								element={
									<ProtectedRoute routeKey='warehouse'>
										<Warehouse />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/my-inventory'
								element={
									<ProtectedRoute routeKey='my_inventory'>
										<MyInventory />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/inventory'
								element={
									<ProtectedRoute routeKey='inventory'>
										<Inventory />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/trash'
								element={
									<ProtectedRoute routeKey='trash'>
										<Trash />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/settings'
								element={
									<ProtectedRoute routeKey='settings'>
										<Settings />
									</ProtectedRoute>
								}
							/>

							<Route
								path='/reports'
								element={
									<ProtectedRoute routeKey='reports'>
										<Reports />
									</ProtectedRoute>
								}
							/>

							<Route path='*' element={<LandingRedirect />} />
						</Routes>
					</section>
				</main>
			</div>
		</div>
	)
}
