# Urban Development Planning Tool

An interactive web application for urban development planning that combines mapping capabilities with AI-powered suggestions.

## Features

- Interactive map selection using Leaflet.js
- Entity identification in selected areas
- AI-powered urban development suggestions using HuggingFace models
- Modern, responsive user interface

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables:
Create a `.env` file with:
```
HUGGINGFACE_API_KEY=your_api_key_here
```

3. Run the application:
```bash
python app.py
```

4. Open http://localhost:5000 in your browser

## Technologies Used

- Backend: Flask (Python)
- Frontend: HTML5, CSS3, JavaScript
- Map Integration: Leaflet.js
- AI Model: HuggingFace Transformers
- Styling: Bootstrap 5 