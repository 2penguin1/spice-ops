output "url" {
  description = "Open this once the first boot has finished. Give it 5-10 minutes."
  value       = "http://${aws_instance.app.public_ip}"
}

output "ssh" {
  description = "How to get on the box and read the boot log."
  value = var.ssh_key_name != "" ? "ssh ec2-user@${aws_instance.app.public_ip}" : "no key pair set — SSH is unavailable"
}

output "public_ip" {
  value = aws_instance.app.public_ip
}
