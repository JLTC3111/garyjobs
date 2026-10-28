"""Create browser-ready gallery images from the supplied Vietnam photo library.

Run manually when new source photos are added. The exported files and manifest
are checked in, so deployments do not need Python, Pillow, or a HEIC decoder.
"""

import json
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()
ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "dist/assets/public/images"

# Captions describe the supplied photographs without identifying the people.
CAPTIONS = {
    "hagiang": {
        "IMG_8705": ("The greener way home", "Thung lũng xanh", "A green valley surrounded by layers of mountains", "Thung lũng xanh giữa những lớp núi trùng điệp"),
        "IMG_8706": ("A stop with a view", "Dừng chân giữa núi đồi", "Travelers at a mountain viewpoint with a Vietnamese flag", "Du khách tại điểm ngắm núi với lá cờ Việt Nam"),
        "IMG_8708": ("Hello from the highlands", "Xin chào từ vùng cao", "A traveler greeting the camera at a mountain viewpoint", "Du khách chào máy ảnh tại điểm ngắm núi"),
        "IMG_8715": ("Chasing waterfalls", "Bên dòng thác", "Travelers beside a waterfall on a mountain road", "Du khách bên thác nước trên đường núi"),
        "IMG_8779": ("Paths through green", "Lối đi giữa màu xanh", "A stone wall and path through green mountain fields", "Bờ đá và lối đi giữa những cánh đồng xanh trên núi"),
        "IMG_8794": ("Roads worth taking", "Những cung đường đáng đi", "Terraced mountain slopes and a winding road in Ha Giang", "Sườn núi bậc thang và đường uốn lượn ở Hà Giang"),
        "IMG_8800": ("Highland moments", "Khoảnh khắc vùng cao", "A traveler in a red top looking across the mountains", "Du khách mặc áo đỏ ngắm núi đồi"),
        "IMG_8802": ("A little travel companion", "Người bạn nhỏ trên đường", "A baby resting in a carrier during a trip", "Em bé nghỉ ngơi trong địu trên chuyến đi"),
        "IMG_8805": ("Bends in the road", "Những khúc quanh", "A mountain road winding through green hills under clouds", "Đường núi quanh co giữa đồi xanh dưới mây"),
        "IMG_8807": ("A highland pause", "Một khoảng nghỉ vùng cao", "A covered terrace opening onto a mountain viewpoint", "Hiên có mái nhìn ra điểm ngắm núi"),
        "IMG_8811": ("Another point of view", "Một góc nhìn khác", "A rustic wooden railing overlooking a green valley", "Lan can gỗ mộc nhìn xuống thung lũng xanh"),
        "IMG_8854": ("By the river", "Bên dòng sông", "Turquoise water between steep rocky hills", "Mặt nước xanh ngọc giữa núi đá dốc"),
        "IMG_8866": ("Between the mountains", "Giữa những ngọn núi", "A boat traveling along a green river through a steep canyon", "Thuyền trên dòng sông xanh giữa hẻm núi dốc"),
        "IMG_8869": ("The slow way downriver", "Chậm rãi theo dòng sông", "A boat railing and green hills beside the river", "Lan can thuyền và đồi xanh bên dòng sông"),
        "IMG_8922": ("Coffee with a view", "Cà phê giữa núi đồi", "A hillside café and tiled rooftops below the mountains", "Quán cà phê bên sườn đồi và mái ngói dưới chân núi"),
        "IMG_8926": ("Above the clouds", "Trên những tầng mây", "A viewpoint terrace above misty mountains", "Hiên ngắm cảnh phía trên núi phủ sương"),
        "IMG_8927": ("A valley in the mist", "Thung lũng trong sương", "Clouds drifting around mountains above a winding river", "Mây quanh núi phía trên dòng sông uốn lượn"),
        "IMG_8934": ("Stone and sky", "Đá và trời", "Stone steps leading to a small building against a rocky hillside", "Bậc đá dẫn lên ngôi nhà nhỏ bên sườn núi đá"),
        "IMG_8935": ("Mountains in layers", "Những lớp núi", "Layered mountain silhouettes disappearing into cloud", "Những lớp núi mờ dần trong mây"),
        "IMG_8939": ("Under a different sky", "Dưới một bầu trời khác", "A rocky mountain path with a view into the valley", "Lối đi trên núi đá nhìn xuống thung lũng"),
        "IMG_8952": ("A quiet place to stop", "Một nơi để dừng chân", "A wooden viewing platform with plants and a Vietnamese flag", "Sàn gỗ ngắm cảnh với cây xanh và cờ Việt Nam"),
        "IMG_8963": ("Stories in the courtyard", "Chuyện kể trong sân", "A traveler in the courtyard of a traditional wooden building", "Du khách trong sân ngôi nhà gỗ truyền thống"),
        "IMG_8964": ("Old roofs, new stories", "Mái cũ, chuyện mới", "Tiled roofs and wooden balconies around a courtyard", "Mái ngói và ban công gỗ quanh sân"),
        "IMG_8965": ("A glimpse of local history", "Một góc lịch sử địa phương", "Wooden stairs and a visitor notice in a historic building", "Cầu thang gỗ và bảng hướng dẫn trong tòa nhà lịch sử"),
        "IMG_8990": ("Look up", "Ngước nhìn", "Tall tree trunks and green branches seen from below", "Thân cây cao và tán lá xanh nhìn từ phía dưới"),
        "IMG_8992": ("Take the long way", "Đi một con đường dài hơn", "A grassy path through a grove of tall trees", "Lối đi trên cỏ giữa những hàng cây cao"),
        "IMG_8993": ("One more mountain road", "Thêm một cung đường núi", "A misty mountain road with travelers and motorbikes", "Đường núi trong sương với du khách và xe máy"),
    },
    "hoian": {
        "IMG_2832": ("An everyday morning", "Một buổi sáng thường ngày", "A street-side stall beside an open road in Hoi An", "Quầy hàng ven đường ở Hội An"),
        "IMG_2841": ("Small everyday adventures", "Những khám phá nhỏ mỗi ngày", "A neighborhood playground under the trees", "Sân chơi trong khu phố dưới những hàng cây"),
        "IMG_2842": ("Room to play", "Không gian vui chơi", "A yellow slide at an outdoor playground", "Cầu trượt vàng tại sân chơi ngoài trời"),
        "IMG_2844": ("A slower afternoon", "Một buổi chiều chậm hơn", "Climbing frames in a quiet outdoor playground", "Khung leo trèo tại sân chơi ngoài trời yên tĩnh"),
        "IMG_2845": ("Under the Hoi An sky", "Dưới bầu trời Hội An", "A park and street lamps under a blue sky", "Công viên và đèn đường dưới bầu trời xanh"),
        "IMG_2847": ("A taste of Hoi An", "Hương vị Hội An", "A bowl of noodles with fresh herbs and vegetables", "Tô mì với rau và các loại rau thơm"),
        "IMG_2849": ("Follow the yellow walls", "Theo những bức tường vàng", "A narrow yellow-walled alley with a brick arch and motorbikes", "Ngõ nhỏ tường vàng với vòm gạch và xe máy"),
        "IMG_2850": ("Coffee, then wander", "Cà phê rồi dạo bước", "Iced coffee and a banh mi bag on a café table", "Cà phê đá và túi bánh mì trên bàn quán"),
    },
    "hanoi": {
        "IMG_9079": ("A little colour after class", "Chút sắc màu sau giờ học", "An immersive room filled with purple projected artwork", "Căn phòng tràn ngập tác phẩm trình chiếu màu tím"),
        "IMG_9082": ("Step into the colour", "Bước vào sắc màu", "Large projected brushstrokes filling the walls of an art room", "Nét cọ được chiếu lớn trên tường phòng nghệ thuật"),
        "IMG_9169": ("A bright afternoon", "Một buổi chiều trong nắng", "Palm trees and a city street beneath large white clouds", "Hàng cọ và phố xá dưới những đám mây trắng lớn"),
        "IMG_9170": ("Take the scenic route", "Chọn con đường đẹp", "A tiled promenade alongside a modern building", "Lối đi lát gạch dọc theo tòa nhà hiện đại"),
        "IMG_9171": ("A different city rhythm", "Một nhịp sống thành phố khác", "Colorful buildings seen through a tree-lined square", "Những tòa nhà nhiều màu qua quảng trường có cây xanh"),
        "IMG_9172": ("Around the next corner", "Phía sau góc phố", "A pedestrian walkway with red bridge railings and colorful buildings", "Lối đi bộ với lan can cầu đỏ và các tòa nhà nhiều màu"),
        "IMG_9173": ("Walk by the water", "Dạo bước bên mặt nước", "A waterside promenade shaded by trees", "Lối đi ven mặt nước dưới bóng cây"),
        "IMG_9174": ("Colour along the waterfront", "Sắc màu bên mặt nước", "Colorful waterfront buildings reflected in a canal", "Những tòa nhà nhiều màu bên kênh nước"),
        "IMG_9175": ("City days, small surprises", "Ngày thành phố, niềm vui nhỏ", "A colorful display beside a canal and pastel buildings", "Trang trí nhiều màu bên kênh và những tòa nhà màu nhạt"),
        "IMG_9176": ("An unhurried afternoon", "Một buổi chiều thong thả", "A long paved walkway beside waterfront buildings", "Lối đi lát gạch dài bên các tòa nhà ven mặt nước"),
        "IMG_9177": ("Find your next café", "Tìm quán cà phê tiếp theo", "A café in a colorful multi-story building", "Quán cà phê trong tòa nhà nhiều tầng đầy màu sắc"),
        "IMG_9178": ("Pause for a coffee", "Dừng chân uống cà phê", "Outdoor seating in front of a lively café façade", "Chỗ ngồi ngoài trời trước mặt tiền quán cà phê"),
        "IMG_9190": ("Room to celebrate", "Không gian cho niềm vui", "A broad courtyard in front of an event venue", "Sân rộng phía trước địa điểm tổ chức sự kiện"),
        "IMG_9191": ("An evening to remember", "Một buổi tối đáng nhớ", "A grand event venue with blue and gold columns", "Địa điểm sự kiện với những cột lớn màu xanh và vàng"),
        "IMG_9192": ("A golden-hour arrival", "Đến nơi lúc nắng chiều", "A curved building and garden in warm afternoon light", "Tòa nhà cong và khu vườn trong ánh nắng chiều ấm"),
        "IMG_9193": ("A different perspective", "Một góc nhìn mới", "An escalator inside an ornate, bright interior", "Thang cuốn trong không gian sáng với trang trí cầu kỳ"),
        "IMG_9194": ("Art along the way", "Nghệ thuật trên hành trình", "A large forest landscape artwork on an interior wall", "Tác phẩm phong cảnh rừng lớn trên tường trong nhà"),
        "IMG_9195": ("Welcoming the celebration", "Chào đón ngày vui", "A lion dance performer and a guest at a gathering", "Người biểu diễn múa lân và khách trong buổi gặp mặt"),
        "IMG_9196": ("Colours of celebration", "Sắc màu ngày vui", "Guests in colorful traditional clothes at an event", "Khách mặc trang phục truyền thống nhiều màu trong sự kiện"),
        "IMG_9197": ("Together in the city", "Cùng nhau giữa thành phố", "Friends gathering for a group photograph indoors", "Bạn bè chụp ảnh tập thể trong nhà"),
        "IMG_9198": ("People make the place", "Con người làm nên nơi chốn", "A group of friends posing in a decorated hall", "Nhóm bạn chụp ảnh trong sảnh được trang trí"),
        "IMG_9199": ("A shared moment", "Khoảnh khắc bên nhau", "A group sharing a photograph at a gathering", "Mọi người chụp ảnh chung trong buổi gặp mặt"),
        "IMG_9200": ("Look up, once more", "Lại một lần ngước nhìn", "An ornate gold and white interior seen from below", "Nội thất trắng và vàng cầu kỳ nhìn từ phía dưới"),
    },
}

manifest = []
FEATURED = {"hagiang": "IMG_8794", "hoian": "IMG_2849", "hanoi": "IMG_9174"}
for region in ["hagiang", "hoian", "hanoi"]:
    sources = sorted((PHOTOS / region).iterdir(), key=lambda path: (path.stem.upper() != FEATURED[region], path.name))
    for source in sources:
        if source.suffix.lower() not in {".jpg", ".jpeg", ".heic", ".png"}:
            continue
        caption = CAPTIONS[region].get(source.stem.upper())
        if not caption:
            raise ValueError(f"Add an English/Vietnamese caption for {source}")
        target = source.parent / "gallery" / f"{source.stem.lower()}.webp"
        target.parent.mkdir(exist_ok=True)
        image = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
        image.thumbnail((800, 800), Image.Resampling.LANCZOS)
        # Saving without EXIF also leaves personal camera/GPS metadata out.
        image.save(target, "WEBP", quality=84, method=6)
        title_en, title_vi, alt_en, alt_vi = caption
        manifest.append({
            "id": f"{region}-{source.stem.lower()}",
            "region": region,
            "source": str(source.relative_to(ROOT / "dist")),
            "src": str(target.relative_to(ROOT / "dist")),
            "width": image.width,
            "height": image.height,
            "title": {"en": title_en, "vi": title_vi},
            "alt": {"en": alt_en, "vi": alt_vi},
        })

target_manifest = ROOT / "src/data/photos.json"
target_manifest.parent.mkdir(parents=True, exist_ok=True)
target_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
total_bytes = sum((ROOT / "dist" / photo["src"]).stat().st_size for photo in manifest)
print(f"Exported {len(manifest)} photographs ({total_bytes / 1024 / 1024:.1f} MB total).")
