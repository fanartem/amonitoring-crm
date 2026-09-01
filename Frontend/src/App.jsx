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

import ProtectedRoute from './components/ProtectedRoute'
import AccessDenied from './components/AccessDenied'
import { clearAuthData, isTokenExpired } from './api'
import { getStoredUser, resolveLandingRoute } from './utils/access'

// Куда отправлять человека, когда конкретный маршрут не указан.
// Жёсткий /requests уводил бы сотрудника без requests.view на AccessDenied.
const LandingRedirect = () => <Navigate to={resolveLandingRoute()} replace />

export default function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		const token = localStorage.getItem('access_token')
		const storedUser = getStoredUser()

		// Одного токена мало: без user_data все проверки прав дают false,
		// и человек оказывается формально вошедшим, но запертым на AccessDenied.
		if (!token || isTokenExpired(token) || !storedUser?.id) {
			clearAuthData()
			setIsAuthenticated(false)
		} else {
			setIsAuthenticated(true)
		}

		setIsLoading(false)
	}, [])

	if (isLoading) return null

	if (!isAuthenticated) {
		return <Entrance />
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
