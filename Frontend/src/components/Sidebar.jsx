import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'

export default function Sidebar() {
	const [isOpen, setIsOpen] = useState(false) // Состояние: открыт ли сайдбар на мобилке

	const userDataStr = localStorage.getItem('user_data')
	const user = userDataStr ? JSON.parse(userDataStr) : null
	const isAdmin = user?.role?.toUpperCase() === 'ADMIN'
	const isManager = user?.role?.toUpperCase() === 'MANAGER'
	const isWarehouseManager = user?.role?.toUpperCase() === 'WAREHOUSE_MANAGER'

	const handleLogout = () => {
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')
		window.location.href = '/requests'
	}

	const canViewPrices = ['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(
		user?.role?.toUpperCase(),
	)

	// Закрытие сайдбара при клике вне его (для мобилок)
	useEffect(() => {
		const handleOutsideClick = (e) => {
			if (window.innerWidth <= 768 && !e.target.closest('.sidebar')) {
				setIsOpen(false)
			}
		}
		document.addEventListener('click', handleOutsideClick)
		return () => document.removeEventListener('click', handleOutsideClick)
	}, [])

	const toggleSidebar = (e) => {
		e.stopPropagation()
		setIsOpen(!isOpen)
	}

	return (
		<nav className={`sidebar ${isOpen ? 'active' : ''}`}>
			{/* Кнопка Бургера для мобильных устройств */}
			<button className='menu-btn' onClick={toggleSidebar}>
				&#9776;
			</button>

			<div className='sidebar-top'>
				<NavLink
					to='/requests'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					<i className='fa-solid fa-clipboard-list'></i>
					<span className='link-text'>Заявки</span>
				</NavLink>

				<NavLink
					to='/clients'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					<i className='fa-solid fa-users'></i>
					<span className='link-text'>Клиенты</span>
				</NavLink>

				{canViewPrices && (
					<NavLink
						to='/prices'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						<i className='fa-solid fa-tags'></i>
						<span className='link-text'>Цены</span>
					</NavLink>
				)}

				<NavLink
					to='/employees'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					<i className='fa-solid fa-user-tie'></i>
					<span className='link-text'>Сотрудники</span>
				</NavLink>

				{isAdmin && (
					<NavLink
						to='/approvals'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						<i className='fa-solid fa-user-check'></i>
						<span className='link-text'>Одобрение</span>
					</NavLink>
				)}

				{(isWarehouseManager || isAdmin) && (
					<NavLink
						to='/warehouse'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						<i className='fa-solid fa-warehouse'></i>
						<span className='link-text'>Склад</span>
					</NavLink>
				)}

				{isAdmin && (
					<NavLink
						to='/trash'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						<i className='fa-solid fa-trash'></i>
						<span className='link-text'>Корзина</span>
					</NavLink>
				)}
			</div>

			<div className='sidebar-bottom'>
				<NavLink
					to='/settings'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					<i className='fa-solid fa-gear'></i>
					<span className='link-text'>Настройки</span>
				</NavLink>

				<div className='nav-item' onClick={handleLogout} style={{ cursor: 'pointer' }}>
					<i className='fa-solid fa-right-from-bracket'></i>
					<span className='link-text'>Выход</span>
				</div>
			</div>
		</nav>
	)
}