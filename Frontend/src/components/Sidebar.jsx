import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import { canAccessRoute, getStoredUser } from '../utils/access'
import { clearAuthData } from '../api'

export default function Sidebar() {
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
		// Единая очистка из api.js: легаси-ключ user и плашка
		// в sessionStorage иначе переживут выход.
		clearAuthData()

		window.location.href = '/'
	}

	return (
		<nav className={`sidebar ${isOpen ? 'active' : ''}`}>
			<button className='menu-btn' onClick={toggleSidebar}>
				<i>&#9776;</i> <span className='link-text'>Меню</span>
			</button>

			<div className='sidebar-top'>
				{canView('calendar') && (
					<NavLink
						to='/calendar'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-calendar-days'></i>
						<span className='link-text'>Календарь</span>
					</NavLink>
				)}

				{canView('requests') && (
					<NavLink
						to='/requests'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-clipboard-list'></i>
						<span className='link-text'>Заявки</span>
					</NavLink>
				)}

				{canView('support_requests') && (
					<NavLink
						to='/support-requests'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-headset'></i>
						<span className='link-text'>Тех. поддержка</span>
					</NavLink>
				)}

				{canView('clients') && (
					<NavLink
						to='/clients'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-users'></i>
						<span className='link-text'>Клиенты</span>
					</NavLink>
				)}

				{canView('prices') && (
					<NavLink
						to='/prices'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-tags'></i>
						<span className='link-text'>Цены</span>
					</NavLink>
				)}

				{/* {canView('reports') && (
					<NavLink
						to='/reports'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-chart-column'></i>
						<span className='link-text'>Отчёты</span>
					</NavLink>
				)} */}

				{canView('employees') && (
					<NavLink
						to='/employees'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-user-tie'></i>
						<span className='link-text'>Сотрудники</span>
					</NavLink>
				)}

				{canView('approvals') && (
					<NavLink
						to='/approvals'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-user-check'></i>
						<span className='link-text'>Одобрение</span>
					</NavLink>
				)}

				{canView('warehouse') && (
					<NavLink
						to='/warehouse'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-warehouse'></i>
						<span className='link-text'>Склад</span>
					</NavLink>
				)}

				{canView('my_inventory') && (
					<NavLink
						to='/my-inventory'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-toolbox'></i>
						<span className='link-text'>Мой инвентарь</span>
					</NavLink>
				)}

				{canView('inventory') && (
					<NavLink
						to='/inventory'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-boxes-stacked'></i>
						<span className='link-text'>Инвентарь</span>
					</NavLink>
				)}

				{canView('trash') && (
					<NavLink
						to='/trash'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-trash'></i>
						<span className='link-text'>Корзина</span>
					</NavLink>
				)}
			</div>

			<div className='sidebar-bottom'>
				{canView('settings') && (
					<NavLink
						to='/settings'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-gear'></i>
						<span className='link-text'>Настройки</span>
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
