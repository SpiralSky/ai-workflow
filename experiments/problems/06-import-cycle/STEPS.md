1. Read models.py — see it imports from services
2. Read services.py — see it imports from models (circular)
3. Recognize circular dependency
4. Create utils.py with format_price
5. Update models.py to import from utils
6. Remove the circular import from services.py (Product no longer needed at module level)
7. Run tests
