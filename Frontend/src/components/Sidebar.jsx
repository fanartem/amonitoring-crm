import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  const userDataStr = localStorage.getItem('user_data');
  const user = userDataStr ? JSON.parse(userDataStr) : null;
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
  const isManager = user?.role?.toUpperCase() === 'MANAGER';
  const isWarehouseManager = user?.role?.toUpperCase() === 'WAREHOUSE_MANAGER';

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_data');
    window.location.href = '/login';
  };

  return (
		<nav className='sidebar'>
			<div className='sidebar-top'>
				<NavLink
					to='/'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					end
				>
					Главная
				</NavLink>

				<NavLink
					to='/clients'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					Клиенты
				</NavLink>

				<NavLink
					to='/requests'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					Заявки
				</NavLink>

				<NavLink
					to='/employees'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					Сотрудники
				</NavLink>

				{(isWarehouseManager || isAdmin) && (
					<NavLink
						to='/warehouse'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						Склад
					</NavLink>
				)}

				{/* Только для администратора */}
				{isAdmin && (
					<NavLink
						to='/approvals'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						Одобрение
					</NavLink>
				)}

				{/* НОВОЕ: Корзина для Админов и Менеджеров */}
				{(isAdmin || isManager) && (
					<NavLink
						to='/trash'
						className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
					>
						Корзина
					</NavLink>
				)}
			</div>

			<div className='sidebar-bottom'>
				<NavLink
					to='/settings'
					className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
				>
					Настройки
				</NavLink>

				<div
					className='nav-item'
					onClick={handleLogout}
					style={{ cursor: 'pointer' }}
				>
					Выход
				</div>
			</div>
		</nav>
	)
}