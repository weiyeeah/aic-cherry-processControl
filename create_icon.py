#!/usr/bin/env python3
import os
from PIL import Image, ImageDraw, ImageFont

def create_icon():
    # 创建512x512的图像
    size = (512, 512)
    img = Image.new('RGBA', size, (70, 130, 180, 255))  # 钢蓝色背景
    
    draw = ImageDraw.Draw(img)
    
    # 绘制圆形背景
    margin = 50
    circle_bbox = [margin, margin, size[0]-margin, size[1]-margin]
    draw.ellipse(circle_bbox, fill=(255, 255, 255, 255), outline=(50, 50, 50, 255), width=8)
    
    # 添加NWAIC文字
    try:
        # 尝试使用系统字体
        font_size = 80
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        # 如果找不到字体，使用默认字体
        font = ImageFont.load_default()
    
    # 计算文字位置使其居中
    text = "NWAIC"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = (size[0] - text_width) // 2
    y = (size[1] - text_height) // 2 - 20
    
    # 绘制文字
    draw.text((x, y), text, fill=(50, 50, 50, 255), font=font)
    
    # 添加一个小的机器人图标
    robot_size = 100
    robot_x = size[0] // 2 - robot_size // 2
    robot_y = y + text_height + 20
    
    # 简单的机器人形状
    robot_color = (100, 149, 237, 255)  # 矢车菊蓝
    
    # 机器人头部
    head_bbox = [robot_x, robot_y, robot_x + robot_size, robot_y + robot_size // 2]
    draw.rectangle(head_bbox, fill=robot_color, outline=(50, 50, 50, 255), width=3)
    
    # 机器人眼睛
    eye_size = 8
    left_eye_x = robot_x + robot_size // 4 - eye_size // 2
    right_eye_x = robot_x + 3 * robot_size // 4 - eye_size // 2
    eye_y = robot_y + robot_size // 6
    
    draw.ellipse([left_eye_x, eye_y, left_eye_x + eye_size, eye_y + eye_size], fill=(255, 255, 255, 255))
    draw.ellipse([right_eye_x, eye_y, right_eye_x + eye_size, eye_y + eye_size], fill=(255, 255, 255, 255))
    
    # 机器人身体
    body_y = robot_y + robot_size // 2
    body_bbox = [robot_x + robot_size // 4, body_y, robot_x + 3 * robot_size // 4, body_y + robot_size // 2]
    draw.rectangle(body_bbox, fill=robot_color, outline=(50, 50, 50, 255), width=3)
    
    return img

if __name__ == "__main__":
    # 创建图标
    icon = create_icon()
    
    # 保存为512x512的PNG文件
    icon.save("build/icon.png", "PNG")
    print("512x512 icon created successfully at build/icon.png")
    
    # 同时创建其他尺寸的图标
    sizes = [16, 32, 48, 64, 128, 256]
    for size in sizes:
        resized = icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(f"build/icon_{size}x{size}.png", "PNG")
        print(f"Created {size}x{size} icon")