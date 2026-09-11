# Not secret: where Cognito may send a signed-in person back. Committed so CI's apply sees the
# same list a laptop does; the phone's tunnel and LAN entries change with the network.
callback_urls = [
  "kanili://auth",
  "exp://192.168.68.55:8081/--/auth",
  "http://localhost:8081/auth",
  "https://d3lykvs28o7qrc.cloudfront.net/auth",
]
