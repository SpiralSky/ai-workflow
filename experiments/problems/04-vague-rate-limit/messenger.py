sent = []

def send_message(user_id, text):
    """Pretend to send a message."""
    sent.append((user_id, text))
    return True
