import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import { getStoredUser, hasAnyPermission, toBool } from '../utils/access'

export default function Sidebar() {
	const [isOpen, setIsOpen] = useState(false)

	const currentUser = getStoredUser()
	const userRole = currentUser.role || null

	const isAdmin = userRole === 'ADMIN'
	const isRop = userRole === 'ROP'
	const isManager = userRole === 'MANAGER'
	const isTechSupport = userRole === 'TECH_SUPPORT'
	const isAccountant = userRole === 'ACCOUNTANT'
	const isTechnician = userRole === 'TECHNICIAN'
	const isSeniorTechnician = userRole === 'SENIOR_TECHNICIAN'
	const isWarehouseManager = userRole === 'WAREHOUSE_MANAGER'

	/*
		Новая логика:
		- Супер-Админ видит всё через hasPermission / hasAnyPermission.
		- Основной источник — permissions из localStorage.user_data.permissions.
		- Legacy fallback временно оставляем, чтобы старые роли не сломались,
		  пока все страницы не переведены полностью на permissions.
	*/

	const canViewRequests =
		hasAnyPermission(currentUser, [
			'requests.view',
			'requests.view_all',
			'requests.view_own',
			'requests.view_assigned',
			'requests.create',
		]) ||
		isAdmin ||
		isRop ||
		isManager ||
		isTechSupport ||
		isAccountant ||
		isWarehouseManager ||
		isTechnician ||
		isSeniorTechnician

	const canViewCalendar =
		hasAnyPermission(currentUser, [
			'calendar.view',
			'requests.view',
			'requests.view_all',
			'requests.view_own',
			'requests.view_assigned',
		]) || canViewRequests

	const canViewClients =
		hasAnyPermission(currentUser, [
			'clients.view',
			'clients.view_all',
			'clients.view_own',
			'clients.manage',
		]) ||
		isAdmin ||
		isRop ||
		isManager ||
		isTechSupport ||
		isAccountant ||
		isWarehouseManager

	const canViewPrices =
		hasAnyPermission(currentUser, [
			'prices.view',
			'prices.manage',
			'base_prices.view',
			'client_prices.view',
		]) ||
		isAdmin ||
		isRop ||
		isManager ||
		isTechSupport ||
		isAccountant

	const canViewApprovals =
		hasAnyPermission(currentUser, ['employees.approve', 'employees.manage']) ||
		isAdmin ||
		isRop

	const canViewEmployees = true

	const canViewWarehouse =
		hasAnyPermission(currentUser, [
			'warehouse.view',
			'warehouse.manage',
			'warehouse.items.view',
			'warehouse.items.manage',
		]) ||
		isAdmin ||
		isWarehouseManager

	const canViewFullInventory =
		hasAnyPermission(currentUser, [
			'warehouse.view',
			'warehouse.manage',
			'warehouse.items.view',
			'warehouse.items.manage',
		]) ||
		isAdmin ||
		isWarehouseManager ||
		isSeniorTechnician

	const canViewMyInventory =
		toBool(currentUser.can_be_request_executor) ||
		hasAnyPermission(currentUser, [
			'warehouse.my_inventory.view',
			'warehouse.inventory.view_own',
		]) ||
		isTechnician ||
		isSeniorTechnician

	const canViewTrash =
		hasAnyPermission(currentUser, [
			'trash.view',
			'trash.manage',
			'clients.restore',
			'vehicles.restore',
			'clients.delete',
			'vehicles.delete',
		]) ||
		isAdmin ||
		isRop

	const canViewReports =
		hasAnyPermission(currentUser, ['reports.view', 'reports.manage']) ||
		canViewPrices

	const canViewSupportRequests =
		hasAnyPermission(currentUser, [
			'support_requests.view',
			'support_requests.create',
			'support_requests.manage',
		]) ||
		isAdmin ||
		isRop ||
		isManager ||
		isTechSupport ||
		isAccountant ||
		isWarehouseManager

	const canViewSettings = true

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
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')
		window.location.href = '/login'
	}

	return (
		<nav className={`sidebar ${isOpen ? 'active' : ''}`}>
			<button className='menu-btn' onClick={toggleSidebar}>
				<i>&#9776;</i> <span className='link-text'>Меню</span>
			</button>

			<div className='sidebar-top'>
				{canViewCalendar && (
					<NavLink
						to='/calendar'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-calendar-days'></i>
						<span className='link-text'>Календарь</span>
					</NavLink>
				)}

				{canViewRequests && (
					<NavLink
						to='/requests'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-clipboard-list'></i>
						<span className='link-text'>Заявки</span>
					</NavLink>
				)}

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

				{canViewEmployees && (
					<NavLink
						to='/employees'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
						onClick={handleMenuClick}
					>
						<i className='fa-solid fa-user-tie'></i>
						<span className='link-text'>Сотрудники</span>
					</NavLink>
				)}

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

				{canViewMyInventory && (
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
				{canViewSettings && (
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
