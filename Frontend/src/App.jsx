import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Clients from './components/Clients'
import Approvals from './components/Approvals'
import Home from './components/Home'
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

const isTokenExpired = token => {
	try {
		if (!token) return true

		const payload = JSON.parse(atob(token.split('.')[1]))

		if (!payload.exp) return true

		const nowInSeconds = Date.now() / 1000

		return payload.exp < nowInSeconds
	} catch {
		return true
	}
}

const clearAuthData = () => {
	localStorage.removeItem('access_token')
	localStorage.removeItem('user_data')
}

export default function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		const token = localStorage.getItem('access_token')

		if (!token || isTokenExpired(token)) {
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

			<div className='body-row'>
				<Sidebar />

				<main className='main'>
					<section
						className='content-section active'
						style={{ display: 'block', overflowY: 'auto', width: '100%' }}
					>
						<Routes>
							<Route path='/' element={<Navigate to='/requests' replace />} />
							<Route
								path='/login'
								element={<Navigate to='/requests' replace />}
							/>

							{/* Home временно оставляем, но напрямую на него не кидаем */}
							<Route path='/home' element={<Home />} />

							<Route path='/warehouse' element={<Warehouse />} />
							<Route path='/trash' element={<Trash />} />
							<Route path='/approvals' element={<Approvals />} />
							<Route path='/clients' element={<Clients />} />
							<Route path='/requests' element={<Requests />} />
							<Route path='/employees' element={<Employees />} />
							<Route path='/settings' element={<Settings />} />
							<Route path='/prices' element={<Prices />} />
							<Route path='/my-inventory' element={<MyInventory />} />
							<Route path='/inventory' element={<Inventory />} />

							<Route path='*' element={<Navigate to='/requests' replace />} />
						</Routes>
					</section>
				</main>
			</div>
		</div>
	)
}
