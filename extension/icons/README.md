# APIK Extension Icons

The extension requires PNG icons in the following sizes:
- icon16.png (16x16)
- icon32.png (32x32)
- icon48.png (48x48)
- icon128.png (128x128)

You can generate them from icon.svg using:

```bash
# Using ImageMagick
convert -background none icon.svg -resize 16x16 icon16.png
convert -background none icon.svg -resize 32x32 icon32.png
convert -background none icon.svg -resize 48x48 icon48.png
convert -background none icon.svg -resize 128x128 icon128.png

# Or using Inkscape
inkscape -w 16 -h 16 icon.svg -o icon16.png
inkscape -w 128 -h 128 icon.svg -o icon128.png
```

For development, you can also use a placeholder PNG by base64-encoding a simple image.
