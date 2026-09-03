import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import { canAccessRoute, getStoredUser } from '../../utils/access'
import { clearAuthData } from '../../api'

// Собран тем же способом, что Sidebar.jsx: список пунктов + canAccessRoute.
// Классы те же, поэтому кабинет наследует оформление CRM без отдельного CSS.
// Третьего механизма проверки прав на фронте не появляется.
export default function PortalSidebar() {
	const [isOpen, setIsOpen] = useState(false)

	const currentUser = getStoredUser()
	const canView = routeKey => canAccessRoute(routeKey, currentUser)

	useEffect(() => {
		const handleOutsideClick = e => {
			if (window.innerWidth <= 768 && !e.target.closest('.sidebar')) {
				setIsOpen(false)
			}
		}

		document.addEventListener('click', handleOutsideClick)

		return () => document.removeEventListener('click', handleOutsideClick)
	}, [])

	const toggleSidebar = e => {
		e.stopPropagation()
		setIsOpen(prev => !prev)
	}

	const handleMenuClick = () => {
		if (window.innerWidth <= 768) {
			setIsOpen(false)
		}
	}

	const handleLogout = () => {
		clearAuthData()

		window.location.href = '/'
	}

	return (
		<nav className={`sidebar ${isOpen ? 'active' : ''}`}>
			<button className='menu-btn' onClick={toggleSidebar}>
				<i>&#9776;</i> <span className='link-text'>Меню</span>
			</button>

			<div className='sidebar-top'>
				{canView('portal_requests') && (
					<NavLink
						to='/portal/requests'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-clipboard-list'></i>
						<span className='link-text'>Заявки</span>
					</NavLink>
				)}

				{canView('portal_vehicles') && (
					<NavLink
						to='/portal/vehicles'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-car'></i>
						<span className='link-text'>Автомобили</span>
					</NavLink>
				)}

				{canView('portal_subclients') && (
					<NavLink
						to='/portal/subclients'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-sitemap'></i>
						<span className='link-text'>Подклиенты</span>
					</NavLink>
				)}
			</div>

			<div className='sidebar-bottom'>
				{canView('portal_profile') && (
					<NavLink
						to='/portal/profile'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-user'></i>
						<span className='link-text'>Профиль</span>
					</NavLink>
				)}

				<div
					className='nav-item'
					onClick={handleLogout}
					style={{ cursor: 'pointer' }}
				>
					<i className='fa-solid fa-right-from-bracket'></i>
					<span className='link-text'>Выход</span>
				</div>
			</div>
		</nav>
	)
}
