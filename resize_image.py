from PIL import Image

# Load the original image
img = Image.open("elon.jpg")

# Resize and save images
sizes = [(16, 16), (48, 48), (128, 128)]
for size in sizes:
    resized_img = img.resize(size, Image.Resampling.LANCZOS)
    resized_img.save(f"icon-{size[0]}.png")
