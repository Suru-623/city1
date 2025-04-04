from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
from flask_cors import CORS
import os
from dotenv import load_dotenv
import requests
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut
from overpy import Overpass
import json
from folium import Map, Marker, Icon, FeatureGroup
import folium
import pandas as pd
import numpy as np
from scipy.spatial import distance
from collections import Counter
from sklearn.cluster import DBSCAN
from shapely.geometry import Point, Polygon
import geopandas as gpd
import spacy
from folium import plugins
from folium.plugins import Draw, MousePosition, MeasureControl
import branca.colormap as cm
import asyncio
import torch
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
# from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline


# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize models - Replace with alternative NER implementation
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    import subprocess
    subprocess.run(["python", "-m", "spacy", "download", "en_core_web_sm"])
    nlp = spacy.load("en_core_web_sm")

# Initialize geocoder and Overpass API
geolocator = Nominatim(user_agent="urban_development_planner")
overpass_api = Overpass()

# User database (replace with actual database in production)
users = {}

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def home():
    return render_template('home.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        if email in users and check_password_hash(users[email]['password'], password):
            session['user_id'] = email
            flash('Successfully logged in!', 'success')
            return redirect(url_for('dashboard'))
        
        flash('Invalid email or password.', 'danger')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        organization = request.form.get('organization')
        
        if email in users:
            flash('Email already registered.', 'danger')
            return render_template('register.html')
            
        if password != confirm_password:
            flash('Passwords do not match.', 'danger')
            return render_template('register.html')
            
        users[email] = {
            'name': name,
            'password': generate_password_hash(password),
            'organization': organization
        }
        
        flash('Registration successful! Please login.', 'success')
        return redirect(url_for('login'))
        
    return render_template('register.html')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    flash('You have been logged out.', 'info')
    return redirect(url_for('home'))

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('index.html')

@app.route('/')
def index():
    # Create a map centered at a default location
    m = folium.Map(
        location=[20.5937, 78.9629],  # Center of India
        zoom_start=5,
        tiles='CartoDB positron',  # Clean, modern style
        control_scale=True  # Add scale control
    )

    # Add drawing controls with more options
    draw = Draw(
        draw_options={
            'rectangle': {
                'shapeOptions': {
                    'color': '#ff7800',
                    'weight': 2,
                    'fillOpacity': 0.2
                },
                'showArea': True
            },
            'polygon': {
                'shapeOptions': {
                    'color': '#ff7800',
                    'weight': 2,
                    'fillOpacity': 0.2
                },
                'allowIntersection': False,
                'drawError': {
                    'color': '#e1e100',
                    'message': 'Polygon cannot intersect!'
                },
                'showArea': True
            },
            'polyline': False,
            'circle': False,
            'circlemarker': False,
            'marker': True
        },
        edit_options={
            'featureGroup': None,
            'remove': True,
            'edit': True
        }
    )
    m.add_child(draw)

    # Add locate control (shows user location)
    plugins.LocateControl(
        auto_start=False,
        flyTo=True,
        returnToPrevBounds=True,
        strings={
            'title': 'Show my location',
            'popup': 'You are here!'
        }
    ).add_to(m)

    # Add measure control
    measure = MeasureControl(
        position='topleft',
        primary_length_unit='kilometers',
        secondary_length_unit='miles',
        primary_area_unit='sqmeters',
        secondary_area_unit='acres'
    )
    m.add_child(measure)

    # Add mouse position
    formatter = "function(num) {return L.Util.formatNum(num, 5);};"
    MousePosition(
        position='topright',
        separator=' | ',
        empty_string='NaN',
        lng_first=True,
        num_digits=20,
        prefix='Coordinates:',
        lat_formatter=formatter,
        lng_formatter=formatter
    ).add_to(m)

    # Add scale
    folium.plugins.FloatImage(
        'https://raw.githubusercontent.com/SECOORA/static_assets/master/maps/img/rose.png',
        bottom=5,
        left=1
    ).add_to(m)

    # Add fullscreen option
    plugins.Fullscreen().add_to(m)

    # Add layer control
    folium.LayerControl().add_to(m)

    # Save map to template
    return render_template('index.html', map=m._repr_html_())

@app.route('/get_address', methods=['POST'])
def get_address():
    data = request.json
    lat = data.get('lat')
    lon = data.get('lon')
    
    try:
        location = geolocator.reverse(f"{lat}, {lon}", exactly_one=True)
        if location:
            address = location.raw.get('address', {})
            return jsonify({
                'success': True,
                'address': {
                    'road': address.get('road', ''),
                    'suburb': address.get('suburb', ''),
                    'city': address.get('city', address.get('town', '')),
                    'state': address.get('state', ''),
                    'postcode': address.get('postcode', ''),
                    'country': address.get('country', ''),
                    'formatted': location.address
                }
            })
    except GeocoderTimedOut:
        return jsonify({
            'success': False,
            'error': 'Geocoding service timed out'
        })
    
    return jsonify({
        'success': False,
        'error': 'Address not found'
    })

@app.route('/area1')
def analyze_area_1():
    # some code
    pass

@app.route('/area2')
def analyze_area_2():
    # some code
    pass

@app.route('/analyze_area', methods=['POST'])
async def analyze_area():
    data = request.json
    bounds = data.get('bounds')
    
    # Fast parallel processing of analysis
    entities_task = asyncio.create_task(detect_entities_async(bounds))
    
    try:
        entities_data = await entities_task
        analysis_results = await analyze_map_entities_async(entities_data)
        urban_recommendations = await analyze_urban_development_needs_async(
            entities_data, 
            analysis_results
        )
        
        return jsonify({
            'success': True,
            'entities': entities_data,
            'analysis': analysis_results,
            'recommendations': urban_recommendations
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

async def detect_entities_async(bounds):
    """Asynchronous entity detection"""
    # Your existing entity detection code, made async
    pass

async def analyze_map_entities_async(entities_data):
    """Asynchronous entity analysis"""
    # Your existing analysis code, made async
    pass

async def analyze_urban_development_needs_async(entities_data, analysis_results):
    """Asynchronous urban development analysis"""
    # Your existing urban development analysis code, made async
    pass

@app.route('/search_location', methods=['POST'])
def search_location():
    data = request.json
    search_query = data.get('query')
    
    try:
        # Use geolocator to find location from search query
        location = geolocator.geocode(search_query)
        if location:
            # Create a custom icon for the searched location
            icon_html = """
                <div style="font-family: FontAwesome; font-size: 24px; color: #e74c3c;">
                    <i class="fa fa-map-marker"></i>
                </div>
            """
            
            return jsonify({
                'success': True,
                'coordinates': {
                    'lat': location.latitude,
                    'lon': location.longitude
                },
                'address': {
                    'formatted': location.address
                },
                'icon_html': icon_html
            })
    except GeocoderTimedOut:
        return jsonify({
            'success': False,
            'error': 'Geocoding service timed out'
        })
    
    return jsonify({
        'success': False,
        'error': 'Location not found'
    })

def analyze_area(area_data):
    """
    Analyze area characteristics and provide suggestions based on identified entities
    
    Parameters:
    area_data (dict): Dictionary containing area information like:
        - size (float): Area size in square meters
        - current_entities (list): List of existing entities in the area
        - location_type (str): Type of location (urban, suburban, rural)
        - zoning (str): Zoning classification
    
    Returns:
    dict: Analysis results and suggestions
    """
    analysis_result = {
        'identified_entities': {},
        'suggestions': [],
        'utilization_score': 0
    }
    
    # Analyze existing entities
    entity_categories = {
        'buildings': [],
        'green_spaces': [],
        'infrastructure': [],
        'commercial': [],
        'residential': []
    }
    
    for entity in area_data['current_entities']:
        category = determine_entity_category(entity)
        entity_categories[category].append(entity)
    
    # Calculate space utilization
    total_area = area_data['size']
    used_area = calculate_used_area(entity_categories)
    utilization_ratio = (used_area / total_area) * 100
    
    # Generate suggestions based on analysis
    if utilization_ratio < 60:
        analysis_result['suggestions'].append("Consider developing unused space")
    
    # Check green space ratio
    green_space_ratio = len(entity_categories['green_spaces']) / len(area_data['current_entities'])
    if green_space_ratio < 0.2:
        analysis_result['suggestions'].append("Increase green spaces for better environmental balance")
    
    # Zoning-specific suggestions
    if area_data['zoning'] == 'commercial':
        if len(entity_categories['commercial']) < 3:
            analysis_result['suggestions'].append("Potential for more commercial development")
    elif area_data['zoning'] == 'residential':
        if len(entity_categories['residential']) < 5:
            analysis_result['suggestions'].append("Space available for residential development")
    
    # Location-specific analysis
    if area_data['location_type'] == 'urban':
        analyze_urban_characteristics(analysis_result, entity_categories)
    elif area_data['location_type'] == 'suburban':
        analyze_suburban_characteristics(analysis_result, entity_categories)
    
    analysis_result['identified_entities'] = entity_categories
    analysis_result['utilization_score'] = utilization_ratio
    
    return analysis_result

def determine_entity_category(entity):
    """Helper function to categorize entities"""
    entity_mapping = {
        'house': 'residential',
        'apartment': 'residential',
        'store': 'commercial',
        'office': 'commercial',
        'park': 'green_spaces',
        'road': 'infrastructure',
        'parking': 'infrastructure',
        'garden': 'green_spaces'
    }
    return entity_mapping.get(entity, 'other')

def calculate_used_area(entity_categories):
    """Calculate total used area based on entity types"""
    # Implementation would depend on specific area requirements
    # This is a simplified example
    total_used = 0
    for category in entity_categories.values():
        total_used += len(category) * 100  # Assuming each entity uses 100 sq meters
    return total_used

def analyze_urban_characteristics(analysis_result, entity_categories):
    """Analyze urban-specific characteristics"""
    if len(entity_categories['infrastructure']) < 2:
        analysis_result['suggestions'].append("Improve urban infrastructure connectivity")
    if len(entity_categories['commercial']) > len(entity_categories['residential']):
        analysis_result['suggestions'].append("Consider mixed-use development for better urban balance")

def analyze_suburban_characteristics(analysis_result, entity_categories):
    """Analyze suburban-specific characteristics"""
    if len(entity_categories['green_spaces']) < len(entity_categories['residential']) * 0.5:
        analysis_result['suggestions'].append("Add more suburban green spaces")
    if len(entity_categories['infrastructure']) < len(entity_categories['residential']) * 0.3:
        analysis_result['suggestions'].append("Improve suburban connectivity")

def analyze_area_with_mapping(area_entities):
    """
    Analyze and map entities in an area with their addresses
    
    Parameters:
    area_entities (list): List of dictionaries containing entity information:
        - name: Name of entity
        - address: Full address
        - type: Type of entity
        - details: Additional entity details
    
    Returns:
    dict: Analysis results and map
    """
    # Initialize geocoder
    geolocator = Nominatim(user_agent="area_analyzer")
    
    # Initialize results dictionary
    analysis_result = {
        'mapped_entities': [],
        'entity_clusters': {},
        'map_object': None,
        'density_analysis': {}
    }
    
    # Process entities and get coordinates
    entities_with_coords = []
    
    for entity in area_entities:
        try:
            # Geocode the address
            location = geolocator.geocode(entity['address'])
            if location:
                entities_with_coords.append({
                    'name': entity['name'],
                    'type': entity['type'],
                    'lat': location.latitude,
                    'lon': location.longitude,
                    'address': entity['address'],
                    'details': entity['details']
                })
        except Exception as e:
            print(f"Error geocoding {entity['name']}: {str(e)}")
    
    # Create map centered on the first entity
    if entities_with_coords:
        center_lat = entities_with_coords[0]['lat']
        center_lon = entities_with_coords[0]['lon']
        area_map = folium.Map(location=[center_lat, center_lon], zoom_start=15)
        
        # Create feature groups for different entity types
        entity_layers = {
            'residential': FeatureGroup(name='Residential'),
            'commercial': FeatureGroup(name='Commercial'),
            'green_spaces': FeatureGroup(name='Green Spaces'),
            'infrastructure': FeatureGroup(name='Infrastructure'),
            'other': FeatureGroup(name='Other')
        }
        
        # Add markers for each entity with custom icons
        for entity in entities_with_coords:
            icon_color = get_entity_icon_color(entity['type'])
            icon = Icon(color=icon_color,
                       prefix='fa',
                       icon=get_entity_icon(entity['type']))
            
            popup_content = f"""
                <b>{entity['name']}</b><br>
                Type: {entity['type']}<br>
                Address: {entity['address']}<br>
                {entity['details']}
            """
            
            marker = Marker(
                location=[entity['lat'], entity['lon']],
                popup=popup_content,
                icon=icon
            )
            
            # Add to appropriate layer
            layer_key = entity['type'] if entity['type'] in entity_layers else 'other'
            entity_layers[layer_key].add_child(marker)
        
        # Add all layers to map
        for layer in entity_layers.values():
            area_map.add_child(layer)
        
        # Add layer control
        folium.LayerControl().add_to(area_map)
        
        analysis_result['map_object'] = area_map
        analysis_result['mapped_entities'] = entities_with_coords
        
        # Analyze entity distribution
        analysis_result['entity_clusters'] = analyze_entity_clusters(entities_with_coords)
        analysis_result['density_analysis'] = calculate_density(entities_with_coords)
    
    return analysis_result

def get_entity_icon_color(entity_type):
    """Return appropriate color for entity type"""
    color_mapping = {
        'residential': 'red',
        'commercial': 'blue',
        'green_spaces': 'green',
        'infrastructure': 'gray',
        'other': 'purple'
    }
    return color_mapping.get(entity_type, 'orange')

def get_entity_icon(entity_type):
    """Return appropriate icon for entity type"""
    icon_mapping = {
        'residential': 'home',
        'commercial': 'shopping-cart',
        'green_spaces': 'tree',
        'infrastructure': 'road',
        'other': 'map-marker'
    }
    return icon_mapping.get(entity_type, 'map-marker')

def analyze_entity_clusters(entities):
    """Analyze clusters of entities"""
    clusters = {}
    for entity in entities:
        entity_type = entity['type']
        if entity_type not in clusters:
            clusters[entity_type] = []
        clusters[entity_type].append({
            'name': entity['name'],
            'location': (entity['lat'], entity['lon'])
        })
    return clusters

def calculate_density(entities):
    """Calculate entity density in the area"""
    from sklearn.neighbors import KernelDensity
    import numpy as np
    
    density_analysis = {}
    for entity_type in set(e['type'] for e in entities):
        type_entities = [e for e in entities if e['type'] == entity_type]
        if len(type_entities) > 1:
            coordinates = np.array([[e['lat'], e['lon']] for e in type_entities])
            kde = KernelDensity(bandwidth=0.01)
            kde.fit(coordinates)
            density_analysis[entity_type] = {
                'count': len(type_entities),
                'density_score': float(np.exp(kde.score_samples(coordinates).mean()))
            }
    
    return density_analysis

def analyze_map_entities(entities_data):
    """
    Comprehensive analysis of all entities present in the map
    
    Parameters:
    entities_data (list): List of dictionaries containing entity information
    
    Returns:
    dict: Detailed analysis results
    """
    analysis_results = {
        'entity_statistics': {},
        'spatial_analysis': {},
        'proximity_analysis': {},
        'density_patterns': {},
        'recommendations': []
    }

    # 1. Entity Statistics Analysis
    analysis_results['entity_statistics'] = analyze_entity_statistics(entities_data)
    
    # Only perform spatial and density analysis if location data is available
    if all('address' in entity for entity in entities_data):
        try:
            # Convert addresses to coordinates using geolocator
            geolocator = Nominatim(user_agent="urban_development_planner")
            coordinates = []
            for entity in entities_data:
                try:
                    location = geolocator.geocode(entity['address'])
                    if location:
                        coordinates.append([location.latitude, location.longitude])
                except Exception as e:
                    print(f"Error geocoding address for {entity['name']}: {str(e)}")
            
            if coordinates:
                coordinates = np.array(coordinates)
                # 2. Spatial Distribution Analysis
                analysis_results['spatial_analysis'] = analyze_spatial_distribution(coordinates, entities_data)
                
                # 3. Proximity Analysis
                analysis_results['proximity_analysis'] = analyze_entity_proximity(coordinates, entities_data)
                
                # 4. Density Patterns
                analysis_results['density_patterns'] = analyze_density_patterns(coordinates, entities_data)
        except Exception as e:
            print(f"Error in spatial analysis: {str(e)}")
    
    # 5. Generate Recommendations
    analysis_results['recommendations'] = generate_recommendations(analysis_results)
    
    return analysis_results

def analyze_entity_statistics(entities):
    """Analyze basic statistics of entities"""
    stats = {
        'total_count': len(entities),
        'type_distribution': Counter(e['type'] for e in entities),
        'category_percentages': {},
        'entity_details': {}
    }
    
    # Calculate percentages for each entity type
    for entity_type, count in stats['type_distribution'].items():
        percentage = (count / stats['total_count']) * 100
        stats['category_percentages'][entity_type] = round(percentage, 2)
    
    # Analyze details for each entity type
    for entity_type in set(e['type'] for e in entities):
        type_entities = [e for e in entities if e['type'] == entity_type]
        stats['entity_details'][entity_type] = {
            'count': len(type_entities),
            'names': [e['name'] for e in type_entities],
            'addresses': [e.get('address', 'No address') for e in type_entities]
        }
    
    return stats

def analyze_spatial_distribution(coordinates, entities):
    """Analyze spatial distribution of entities"""
    spatial_analysis = {
        'clustering': {},
        'coverage_area': {},
        'distribution_patterns': {}
    }
    
    if len(coordinates) > 1:  # Need at least 2 points for clustering
        # Perform DBSCAN clustering
        clustering = DBSCAN(eps=0.01, min_samples=2).fit(coordinates)
        
        # Analyze clusters
        n_clusters = len(set(clustering.labels_)) - (1 if -1 in clustering.labels_ else 0)
        spatial_analysis['clustering'] = {
            'number_of_clusters': n_clusters,
            'cluster_sizes': Counter(clustering.labels_)
        }
        
        # Calculate coverage area
        if len(coordinates) > 2:
            try:
                from scipy.spatial import ConvexHull
                hull = ConvexHull(coordinates)
                spatial_analysis['coverage_area'] = {
                    'total_area': hull.area,
                    'perimeter': hull.area  # Using area as approximation
                }
            except Exception as e:
                spatial_analysis['coverage_area'] = {
                    'total_area': 'Could not calculate',
                    'perimeter': 'Could not calculate'
                }
    
    return spatial_analysis

def analyze_entity_proximity(coordinates, entities):
    """Analyze proximity between different types of entities"""
    proximity_analysis = {
        'nearest_neighbors': {},
        'entity_relationships': {},
        'accessibility_scores': {}
    }
    
    # Calculate nearest neighbors for each entity type
    entity_types = set(e['type'] for e in entities)
    
    for entity_type in entity_types:
        type_coords = coordinates[[i for i, e in enumerate(entities) if e['type'] == entity_type]]
        if len(type_coords) > 1:
            distances = distance.cdist(type_coords, coordinates)
            nearest = np.partition(distances, 1, axis=1)[:, 1]
            proximity_analysis['nearest_neighbors'][entity_type] = {
                'average_distance': float(np.mean(nearest)),
                'min_distance': float(np.min(nearest)),
                'max_distance': float(np.max(nearest))
            }
    
    # Analyze relationships between different entity types
    for type1 in entity_types:
        for type2 in entity_types:
            if type1 != type2:
                type1_coords = coordinates[[i for i, e in enumerate(entities) if e['type'] == type1]]
                type2_coords = coordinates[[i for i, e in enumerate(entities) if e['type'] == type2]]
                if len(type1_coords) > 0 and len(type2_coords) > 0:
                    min_dist = np.min(distance.cdist(type1_coords, type2_coords))
                    proximity_analysis['entity_relationships'][f"{type1}_to_{type2}"] = float(min_dist)
    
    # Calculate accessibility scores
    for entity in entities:
        entity_coord = np.array([[entity['lat'], entity['lon']]])
        distances = distance.cdist(entity_coord, coordinates)
        accessibility_score = np.mean(1 / (distances + 1))  # Adding 1 to avoid division by zero
        proximity_analysis['accessibility_scores'][entity['name']] = float(accessibility_score)
    
    return proximity_analysis

def analyze_density_patterns(coordinates, entities):
    """Analyze density patterns of entities"""
    from sklearn.neighbors import KernelDensity
    
    density_patterns = {
        'hotspots': {},
        'density_scores': {},
        'concentration_areas': {}
    }
    
    # Calculate density scores for each entity type
    entity_types = set(e['type'] for e in entities)
    
    for entity_type in entity_types:
        type_coords = coordinates[[i for i, e in enumerate(entities) if e['type'] == entity_type]]
        if len(type_coords) > 1:
            kde = KernelDensity(bandwidth=0.01)
            kde.fit(type_coords)
            density_score = np.exp(kde.score_samples(type_coords).mean())
            density_patterns['density_scores'][entity_type] = float(density_score)
    
    # Identify hotspots (areas with high entity concentration)
    if len(coordinates) > 0:
        kde_all = KernelDensity(bandwidth=0.01)
        kde_all.fit(coordinates)
        scores = kde_all.score_samples(coordinates)
        hotspots = coordinates[scores > np.percentile(scores, 75)]
        density_patterns['hotspots'] = {
            'count': len(hotspots),
            'locations': hotspots.tolist()
        }
    
    return density_patterns

def generate_recommendations(analysis_results):
    """Generate recommendations based on analysis results"""
    recommendations = []
    
    # Check entity distribution
    if analysis_results['entity_statistics']['total_count'] > 0:
        for entity_type, percentage in analysis_results['entity_statistics']['category_percentages'].items():
            if percentage < 10:
                recommendations.append(f"Consider adding more {entity_type} entities to improve balance")
            elif percentage > 50:
                recommendations.append(f"High concentration of {entity_type} entities, consider diversifying")
    
    # Check clustering
    if 'clustering' in analysis_results['spatial_analysis']:
        n_clusters = analysis_results['spatial_analysis']['clustering']['number_of_clusters']
        if n_clusters == 1:
            recommendations.append("Entities are highly centralized. Consider expanding coverage area")
        elif n_clusters > 5:
            recommendations.append("Entities are highly dispersed. Consider consolidating some areas")
    
    # Check proximity
    if 'nearest_neighbors' in analysis_results['proximity_analysis']:
        for entity_type, proximity_data in analysis_results['proximity_analysis']['nearest_neighbors'].items():
            if proximity_data['average_distance'] > 0.1:  # threshold value
                recommendations.append(f"Large gaps between {entity_type} entities. Consider adding intermediate locations")
    
    return recommendations

@app.route('/detect_entities', methods=['POST'])
def detect_entities():
    data = request.json
    lat = data.get('lat')
    lon = data.get('lon')
    radius = data.get('radius', 1000)  # Search radius in meters

    try:
        # Query for various entity types
        query = f"""
        [out:json][timeout:25];
        (
            // Buildings
            way["building"](around:{radius},{lat},{lon});
            
            // Natural features
            way["natural"](around:{radius},{lat},{lon});
            node["natural"](around:{radius},{lat},{lon});
            
            // Water bodies
            way["water"](around:{radius},{lat},{lon});
            way["waterway"](around:{radius},{lat},{lon});
            
            // Green spaces
            way["leisure"="park"](around:{radius},{lat},{lon});
            way["leisure"="garden"](around:{radius},{lat},{lon});
            
            // Roads
            way["highway"](around:{radius},{lat},{lon});
            
            // Places and landmarks
            node["place"](around:{radius},{lat},{lon});
            node["historic"](around:{radius},{lat},{lon});
            node["tourism"](around:{radius},{lat},{lon});
            
            // Amenities
            node["amenity"](around:{radius},{lat},{lon});
        );
        out body;
        >;
        out skel qt;
        """

        result = overpass_api.query(query)
        
        # Initialize entity categories
        entities = {
            'natural_features': [],
            'water_bodies': [],
            'green_spaces': [],
            'roads': [],
            'buildings': [],
            'landmarks': [],
            'amenities': []
        }

        # Process ways and nodes with AI entity detection
        for way in result.ways:
            tags = way.tags
            name = tags.get('name', '')
            
            # Use NLP to detect additional entities in the name/description
            if name:
                doc = nlp(name)
                detected_entities = detect_entities(name)
                entity_types = [ent['entity'] for ent in detected_entities]
                
                # Categorize based on both OSM tags and AI detection
                if 'natural' in tags or 'NATURAL' in entity_types:
                    entities['natural_features'].append({
                        'name': name,
                        'type': tags.get('natural', 'feature'),
                        'detected_types': entity_types
                    })
                elif ('water' in tags or 'waterway' in tags) or 'WATER' in entity_types:
                    entities['water_bodies'].append({
                        'name': name,
                        'type': tags.get('water', tags.get('waterway', 'water body')),
                        'detected_types': entity_types
                    })
                elif 'leisure' in tags and tags['leisure'] in ['park', 'garden']:
                    entities['green_spaces'].append({
                        'name': name,
                        'type': tags['leisure'],
                        'detected_types': entity_types
                    })
                elif 'highway' in tags:
                    entities['roads'].append({
                        'name': name,
                        'type': tags['highway'],
                        'detected_types': entity_types
                    })
                elif 'building' in tags:
                    entities['buildings'].append({
                        'name': name,
                        'type': tags['building'],
                        'detected_types': entity_types
                    })
                elif 'historic' in tags or 'tourism' in tags or 'LOCATION' in entity_types:
                    entities['landmarks'].append({
                        'name': name,
                        'type': tags.get('historic', tags.get('tourism', 'landmark')),
                        'detected_types': entity_types
                    })
                elif 'amenity' in tags or 'FAC' in entity_types:
                    entities['amenities'].append({
                        'name': name,
                        'type': tags.get('amenity', 'facility'),
                        'detected_types': entity_types
                    })

        # Generate analysis
        analysis = {
            'entity_counts': {category: len(items) for category, items in entities.items()},
            'key_findings': generate_key_findings(entities),
            'ai_detected_types': get_ai_detected_types(entities)
        }

        return jsonify({
            'success': True,
            'entities': entities,
            'analysis': analysis
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

def generate_key_findings(entities):
    """Generate key findings about the detected entities"""
    findings = []
    
    # Check entity distribution
    for category, items in entities.items():
        if len(items) == 0:
            findings.append(f"No {category.replace('_', ' ')} detected in the area")
        elif len(items) > 5:
            findings.append(f"High concentration of {category.replace('_', ' ')}")
    
    # Check for interesting combinations
    if len(entities['green_spaces']) > 0 and len(entities['water_bodies']) > 0:
        findings.append("Area has both green spaces and water bodies")
    
    if len(entities['landmarks']) > 2:
        findings.append("Area has multiple landmarks of interest")
    
    return findings

def get_ai_detected_types(entities):
    """Aggregate all AI-detected entity types"""
    ai_types = set()
    for category in entities.values():
        for item in category:
            if 'detected_types' in item:
                ai_types.update(item['detected_types'])
    return list(ai_types)

def detect_entities(text):
    doc = nlp(text)
    return [{'entity': ent.label_, 'word': ent.text} for ent in doc.ents]

@app.route('/blog')
def blog():
    return render_template('blog.html')

@app.route('/about')
def about():
    return render_template('about.html')

if __name__ == '__main__':
    app.secret_key = os.getenv('SECRET_KEY', 'your-secret-key-here')  # Change in production
    app.run(debug=True)

area_data = {
    'size': 10000,  # square meters
    'current_entities': ['house', 'store', 'park', 'road', 'apartment'],
    'location_type': 'urban',
    'zoning': 'mixed'
}

result = analyze_area(area_data)
print(result['suggestions'])  # Get recommendations
print(result['identified_entities'])  # See entity categorization
print(f"Space utilization: {result['utilization_score']}%")

# Example usage:
if __name__ == "__main__":
    sample_entities = [
        {
            'name': 'Central Park',
            'address': '123 Park Avenue, New York, NY',
            'type': 'green_spaces',
            'details': 'Large public park with walking trails'
        },
        {
            'name': 'Downtown Mall',
            'address': '456 Main Street, New York, NY',
            'type': 'commercial',
            'details': 'Shopping center with multiple stores'
        },
        {
            'name': 'Residential Complex',
            'address': '789 Housing Lane, New York, NY',
            'type': 'residential',
            'details': 'Multi-family housing complex'
        }
    ]
    
    analysis = analyze_map_entities(sample_entities)
    
    # Print analysis results
    print("Entity Statistics:", analysis['entity_statistics'])
    print("Spatial Analysis:", analysis['spatial_analysis'])
    print("Proximity Analysis:", analysis['proximity_analysis'])
    print("Density Patterns:", analysis['density_patterns'])
    print("Recommendations:", analysis['recommendations'])

    # After detecting entities
    entities_data = detect_entities(...)  # Your existing entity detection
    analysis_results = analyze_map_entities(...)  # Your existing analysis

    # Get urban development recommendations
    urban_recommendations = analyze_urban_development_needs(entities_data, analysis_results)

    # Access different aspects of the recommendations
    print("Development Needs:", urban_recommendations['development_needs'])
    print("Priority Projects:", urban_recommendations['priority_projects'])
    print("Smart City Initiatives:", urban_recommendations['smart_city_initiatives']) 