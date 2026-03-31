import axios from 'axios'

const api = axios.create({
	baseURL: 'http://localhost:8000', // Адрес твоего FastAPI
})

export default api
