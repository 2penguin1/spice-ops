output "elastic_ip" {
  description = "Point an A record at this. Stable across instance replacements."
  value       = aws_eip.app.public_ip
}

output "url" {
  description = "Open this once the first boot has finished. Give it 5-10 minutes."
  value       = var.domain != "" ? "https://${var.domain}" : "http://${aws_eip.app.public_ip}"
}

output "ssh" {
  description = "How to get on the box and read the boot log."
  value = var.ssh_key_name != "" ? "ssh ec2-user@${aws_eip.app.public_ip}" : "no key pair set — SSH is unavailable"
}
