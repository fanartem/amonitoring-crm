import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router'

export default function Sidebar() {
	const [isOpen, setIsOpen] = useState(false) // Состояние: открыт ли сайдбар на мобилке

	const userDataStr = localStorage.getItem('user_data')
	const user = userDataStr ? JSON.parse(userDataStr) : null
	const userRole = user?.role?.toUpperCase()

	const isAdmin = userRole === 'ADMIN'
	const isRop = userRole === 'ROP'
	const isManager = userRole === 'MANAGER'
	const isTechSupport = userRole === 'TECH_SUPPORT'
	const isTechnician = userRole === 'TECHNICIAN'
	const isSeniorTechnician = userRole === 'SENIOR_TECHNICIAN'
	const isWarehouseManager = userRole === 'WAREHOUSE_MANAGER'

	const canViewFullInventory = [
		'ADMIN',
		'WAREHOUSE_MANAGER',
		'SENIOR_TECHNICIAN',
	].includes(userRole)

	const handleLogout = () => {
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')
		window.location.href = '/requests'
	}

	const canViewClients = !['TECHNICIAN', 'SENIOR_TECHNICIAN'].includes(userRole)

	const canViewPrices = [
		'ADMIN',
		'ROP',
		'MANAGER',
		'TECH_SUPPORT',
		'ACCOUNTANT',
	].includes(userRole)

	const canViewApprovals = ['ADMIN', 'ROP'].includes(userRole)
	const canViewWarehouse = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(userRole)
	const canViewTrash = ['ADMIN', 'ROP'].includes(userRole)

	// Тот же набор ролей, что видит цены — отчёт про заявки логически рядом.
	const canViewReports = [
		'ADMIN',
		'ROP',
		'MANAGER',
		'TECH_SUPPORT',
		'ACCOUNTANT',
	].includes(userRole)

	const canViewSupportRequests = !['TECHNICIAN', 'SENIOR_TECHNICIAN'].includes(
		userRole,
	)

	// Закрытие сайдбара при клике вне его (для мобилок)
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
		setIsOpen(!isOpen)
	}

	// Функция автоматического закрытия при клике на вкладку (только для мобильных)
	const handleMenuClick = () => {
		if (window.innerWidth <= 768) {
			setIsOpen(false)
		}
	}

	return (
		<nav className={`sidebar ${isOpen ? 'active' : ''}`}>
			{/* Кнопка Бургера для мобильных устройств */}
			<button className='menu-btn' onClick={toggleSidebar}>
				<i>&#9776;</i> <span className='link-text'>Меню</span>
			</button>

			<div className='sidebar-top'>
				<NavLink
					to='/calendar'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					onClick={handleMenuClick}
				>
					<i className='fa-solid fa-calendar-days'></i>
					<span className='link-text'>Календарь</span>
				</NavLink>

				<NavLink
					to='/requests'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					onClick={handleMenuClick}
				>
					<i className='fa-solid fa-clipboard-list'></i>
					<span className='link-text'>Заявки</span>
				</NavLink>

				{canViewSupportRequests && (
					<NavLink
						to='/support-requests'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-headset'></i>
						<span className='link-text'>Тех. поддержка</span>
					</NavLink>
				)}

				{canViewClients && (
					<NavLink
						to='/clients'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-users'></i>
						<span className='link-text'>Клиенты</span>
					</NavLink>
				)}

				{canViewPrices && (
					<NavLink
						to='/prices'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-tags'></i>
						<span className='link-text'>Цены</span>
					</NavLink>
				)}

				{/* {canViewReports && (
					<NavLink
						to='/reports'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-chart-column'></i>
						<span className='link-text'>Отчёты</span>
					</NavLink>
				)} */}

				<NavLink
					to='/employees'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					onClick={handleMenuClick}
				>
					<i className='fa-solid fa-user-tie'></i>
					<span className='link-text'>Сотрудники</span>
				</NavLink>

				{canViewApprovals && (
					<NavLink
						to='/approvals'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-user-check'></i>
						<span className='link-text'>Одобрение</span>
					</NavLink>
				)}

				{canViewWarehouse && (
					<NavLink
						to='/warehouse'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-warehouse'></i>
						<span className='link-text'>Склад</span>
					</NavLink>
				)}

				{isTechnician && (
					<NavLink
						to='/my-inventory'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-toolbox'></i>
						<span className='link-text'>Мой инвентарь</span>
					</NavLink>
				)}

				{canViewFullInventory && (
					<NavLink
						to='/inventory'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-boxes-stacked'></i>
						<span className='link-text'>Инвентарь</span>
					</NavLink>
				)}

				{canViewTrash && (
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
				<NavLink
					to='/settings'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					onClick={handleMenuClick}
				>
					<i className='fa-solid fa-gear'></i>
					<span className='link-text'>Настройки</span>
				</NavLink>

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
