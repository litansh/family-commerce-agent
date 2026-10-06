# The Kaniti site: the Expo web build on S3 behind CloudFront. Private bucket,
# origin access control, SPA fallback so deep links resolve to index.html.
# Deploy: npm run deploy:web (exports, syncs, invalidates).

resource "aws_s3_bucket" "web" {
  bucket = "${var.name}-web-${random_id.domain.hex}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # EU + NA edges; Israel is served from EU
  comment             = "Kaniti web"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
    }]
  })
}

output "web_url" { value = "https://${aws_cloudfront_distribution.web.domain_name}" }
output "web_bucket" { value = aws_s3_bucket.web.bucket }
output "web_distribution_id" { value = aws_cloudfront_distribution.web.id }
